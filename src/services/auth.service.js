import User from '../models/User.model.js';
import Auth from '../models/Auth.model.js';
import Referral from '../models/Referral.model.js';
import Account from '../models/Account.model.js';
import Otp from '../models/Otp.model.js';
import { hashPassword, comparePassword, randomToken, sha256 } from '../utils/hash.util.js';
import { sendEmailVerificationMail, sendResetPasswordMail } from '../utils/mail.util.js';
import { generateReferralCode } from '../utils/referralCode.util.js';
import { signAccessToken } from '../utils/jwt.util.js';
import UserDevice from '../models/UserDevice.model.js';
import admin from '../config/firebase.js';
import UserProfile from '../models/UserProfile.model.js';
import mongoose from 'mongoose';
import {
  ACTIVITY_ACTIONS,
  ACTOR_TYPES,
  recordActivity
} from './activity.service.js';

// ✅ ADD THESE IMPORTS
import AccountPlan from '../models/AccountPlan.model.js';
import Broker from '../models/Broker.model.js';
import redis from '../config/redis.js';
import { createAccount } from './account.service.js'; // ✅ adjust path if needed

/**
 * ✅ Redis key for default demo plan
 * We will store ONLY plan_id to keep cache very light
 */
const DEFAULT_DEMO_PLAN_CACHE_KEY = 'default_demo_plan_id';
const DEFAULT_DEMO_PLAN_CACHE_TTL = 60 * 60 * 6; // 6 hours

/** Portal public signup → white-label broker (FP Trades / BLACKOS, etc.) */
async function resolveDefaultBrokerId() {
  const fromId = String(process.env.DEFAULT_BROKER_ID || "").trim();
  if (fromId && mongoose.isValidObjectId(fromId)) return fromId;

  const fromCode = String(process.env.DEFAULT_BROKER_CODE || "")
    .trim()
    .toUpperCase();
  if (!fromCode) return null;

  const broker = await Broker.findOne({ code: fromCode }).select("_id").lean();
  return broker?._id ? String(broker._id) : null;
}

async function getDefaultDemoPlanId() {
  // 1) Redis hit
  const cached = await redis.get(DEFAULT_DEMO_PLAN_CACHE_KEY);
  if (cached) return cached;

  // 2) Redis miss -> fetch from DB
  const plan = await AccountPlan.findOne(
    {
      isActive: true,
      is_demo_allowed: true,
      is_default_demo_plan: true
    },
    { _id: 1 }
  ).lean();

  if (!plan?._id) return null;

  // 3) Save to redis
  await redis.set(
    DEFAULT_DEMO_PLAN_CACHE_KEY,
    String(plan._id),
    'EX',
    DEFAULT_DEMO_PLAN_CACHE_TTL
  );

  return String(plan._id);
}

/* ======================================================
   SIGNUP
====================================================== */

export async function signupService({
  email,
  phone,
  name,
  password,
  confirmPassword,
  signup_ip,
  referral_code
}) {
  if (!password || password !== confirmPassword) {
    throw new Error('Password and confirm password do not match');
  }

  try {
    // 1️⃣ Create user
    const user = await User.create({
      email: email.toLowerCase(),
      phone,
      name,
      signup_ip,
      userType: 'USER',
      isMailVerified: false
    });

    // 2️⃣ Auth (password)
    const passwordHash = await hashPassword(password);

    const token = randomToken();

    await Auth.create({
      user_id: user._id,
      password_hash: passwordHash,
      email_verify_token_hash: sha256(token),
      email_verify_token_expires_at: new Date(
        Date.now() + 24 * 60 * 60 * 1000 // 24 hours
      )
    });

    // 3️⃣ Referral (+ inherit parent user's broker so they stay under same admin)
    let referredBy = null;
    let inheritedBrokerId = null;
    const referralCode =
      typeof referral_code === "string"
        ? referral_code.trim().toUpperCase()
        : null;
    if (referralCode) {
      const parent = await Referral.findOne(
        { referral_code: referralCode },
        { user_id: 1 }
      );
      if (parent) {
        referredBy = parent.user_id;
        const parentUser = await User.findById(parent.user_id)
          .select("brokerId")
          .lean();
        if (parentUser?.brokerId) inheritedBrokerId = parentUser.brokerId;
      }
    }

    const defaultBrokerId = inheritedBrokerId || (await resolveDefaultBrokerId());
    if (defaultBrokerId) {
      await User.updateOne(
        { _id: user._id },
        { $set: { brokerId: defaultBrokerId } },
      );
    }

    await Referral.create({
      user_id: user._id,
      referral_code: generateReferralCode(),
      referred_by: referredBy,
      status: 'PENDING'
    });

    // 4️⃣ Send email confirmation link
    sendEmailVerificationMail(
      user.email,
      `${process.env.FRONTEND_URL}/verify-email?token=${token}`
    ).catch(err => {
      console.error('EMAIL SEND ERROR:', err);
    });

    recordActivity({
      userId: user._id,
      action: ACTIVITY_ACTIONS.USER_CREATED,
      actorId: user._id,
      actorType: ACTOR_TYPES.SELF
    }).catch(err => {
      console.error('ACTIVITY_LOG_ERROR:', err);
    });

    return {
      user_id: user._id,
      message: 'Signup successful, confirmation email sent'
    };
  } catch (err) {
    if (err && err.code === 11000) {
      throw new Error('Email or phone already exists');
    }
    throw err;
  }
}

/* ======================================================
  verify Email
====================================================== */
export async function verifyEmailService(token) {
  // 1️ Validate verification token
  const auth = await Auth.findOne({
    email_verify_token_hash: sha256(token),
    email_verify_token_expires_at: { $gt: new Date() }
  }).lean();

  if (!auth) {
    throw new Error('Invalid or expired verification link');
  }

  // 2️ Activate user & mark email verified
  await User.updateOne(
    { _id: auth.user_id },
    {
      $set: {
        status: 'ACTIVE',
        isMailVerified: true
      }
    }
  );

  // 3️ Remove verification token
  await Auth.updateOne(
    { _id: auth._id },
    {
      $unset: {
        email_verify_token_hash: 1,
        email_verify_token_expires_at: 1
      }
    }
  );

  // 4️ Auto-create DEMO account (non-blocking, Redis + DB driven)
  (async () => {
    try {
      const existingDemo = await Account.countDocuments({
        user_id: auth.user_id,
        account_type: 'demo'
      });

      if (existingDemo > 0) return;

      //  get default demo plan id from redis first
      const demoPlanId = await getDefaultDemoPlanId();
      if (!demoPlanId) return;

      //  create demo account using your createAccount() service
      await createAccount({
        userId: auth.user_id,
        account_plan_id: demoPlanId,
        account_type: 'demo'
      });
    } catch (err) {
      console.error('AUTO DEMO CREATE ERROR:', err);
    }
  })();

  // 5️ Create user profile if not exists
  const profileExists = await UserProfile.findOne(
    { user_id: auth.user_id },
    { _id: 1 }
  ).lean();

  if (!profileExists) {
    UserProfile.create({
      user_id: auth.user_id,
      date_of_birth: null,
      gender: null,
      address_line_1: '',
      address_line_2: '',
      city: '',
      state: '',
      country: '',
      pincode: ''
    }).catch(() => {});
  }

  return {
    user_id: auth.user_id,
    message: 'Email verified successfully'
  };
}

/* ======================================================
   LOGIN
====================================================== */

export async function loginService({
  email,
  password,
  ip,
  device,
  fcmToken
}) {
  // 1 Find user
  const user = await User.findOne({ email: email.toLowerCase() }).lean();
  if (!user) throw new Error('Invalid credentials');

  // 2 Find auth record
  const auth = await Auth.findOne({ user_id: user._id });
  if (!auth) throw new Error('Invalid credentials');

  // 3 Check password
  const ok = await comparePassword(password, auth.password_hash);
  if (!ok) {
    Auth.updateOne(
      { _id: auth._id },
      { $inc: { login_attempts: 1 } }
    ).catch(() => {});
    throw new Error('Invalid credentials');
  }

  // 4 Generate refresh token
  const refreshToken = randomToken();

  // 5 Update auth info
  Auth.updateOne(
    { _id: auth._id },
    {
      $set: {
        login_attempts: 0,
        last_login_at: new Date(),
        last_login_ip: ip,
        last_login_device: device,

        refresh_token_hash: sha256(refreshToken),
        refresh_token_expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ),
        refresh_token_ip: ip,
        refresh_token_device: device
      }
    }
  ).catch(() => {});

  // 6 FCM token handling (unchanged)
  if (fcmToken) {
    process.nextTick(async () => {
      try {
        await UserDevice.updateOne(
          { fcm_token: fcmToken },
          {
            $set: {
              user_id: user._id,
              platform: 'web',
              last_used_at: new Date()
            }
          },
          { upsert: true }
        );

        await admin.messaging().subscribeToTopic(
          [fcmToken],
          'all_users'
        );
      } catch (err) {}
    });
  }

  // 7 Return tokens + role + broker memberships (multi-tenant)
  let memberships = [];
  try {
    const BrokerMembership = (await import("../models/BrokerMembership.model.js")).default;
    const Broker = (await import("../models/Broker.model.js")).default;
    const rows = await BrokerMembership.find({
      userId: user._id,
      status: "ACTIVE",
    }).lean();
    const brokerIds = rows.map((r) => r.brokerId);
    const brokers = await Broker.find({ _id: { $in: brokerIds } })
      .select("code displayName status")
      .lean();
    const byId = new Map(brokers.map((b) => [String(b._id), b]));
    memberships = rows.map((r) => ({
      brokerId: r.brokerId,
      role: r.role,
      permissions: r.permissions || [],
      broker: byId.get(String(r.brokerId)) || null,
    }));
  } catch (_) {}

  return {
    accessToken: signAccessToken(user),
    refreshToken,
    role: user.userType,
    platformRole: user.platformRole || null,
    brokerId: user.brokerId || null,
    memberships,
    isMailVerified: user.isMailVerified,
  };
}

/* ======================================================
   FORGOT PASSWORD (LINK)
====================================================== */

export async function forgotPasswordService(email) {
  const user = await User.findOne({ email: email.toLowerCase() }).lean();
  if (!user) return;

  const auth = await Auth.findOne({ user_id: user._id });
  if (!auth) return;

  const token = randomToken();

  await Auth.updateOne(
    { _id: auth._id },
    {
      $set: {
        reset_token_hash: sha256(token),
        reset_token_expires_at: new Date(
          Date.now() + 10 * 60 * 1000
        )
      }
    }
  );

  console.log('FRONTEND_URL =>', process.env.FRONTEND_URL);

  sendResetPasswordMail(
    user.email,
    `${process.env.FRONTEND_URL}/reset-password?token=${token}`
  ).catch(() => {});
}

/* ======================================================
   RESET PASSWORD
====================================================== */

export async function resetPasswordService(token, newPassword) {
  const auth = await Auth.findOne({
    reset_token_hash: sha256(token),
    reset_token_expires_at: { $gt: new Date() }
  });

  if (!auth) throw new Error('Invalid or expired token');

  const passwordHash = await hashPassword(newPassword);

  await Auth.updateOne(
    { _id: auth._id },
    {
      $set: { password_hash: passwordHash },
      $unset: {
        reset_token_hash: 1,
        reset_token_expires_at: 1
      }
    }
  );

  recordActivity({
    userId: auth.user_id,
    action: ACTIVITY_ACTIONS.PASSWORD_RESET,
    actorId: auth.user_id,
    actorType: ACTOR_TYPES.SELF
  }).catch(err => {
    console.error('ACTIVITY_LOG_ERROR:', err);
  });
}

/* ======================================================
   REFRESH TOKEN 
====================================================== */
export async function refreshTokenService({ refreshToken, ip, device }) {
  const auth = await Auth.findOne({
    refresh_token_hash: sha256(refreshToken),
    refresh_token_expires_at: { $gt: new Date() }
  });

  if (!auth) throw new Error('Invalid or expired refresh token');

  const user = await User.findById(auth.user_id).lean();
  if (!user) throw new Error('User not found');

  const newRefreshToken = randomToken();

  await Auth.updateOne(
    { _id: auth._id },
    {
      $set: {
        refresh_token_hash: sha256(newRefreshToken),
        refresh_token_expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ),
        refresh_token_ip: ip,
        refresh_token_device: device
      }
    }
  );

  return {
    accessToken: signAccessToken(user),
    refreshToken: newRefreshToken
  };
}

/* ================= LOGOUT ================= */

export async function logoutService({ refreshToken }) {
  if (!refreshToken) {
    throw new Error('Refresh token required');
  }

  const result = await Auth.updateOne(
    { refresh_token_hash: sha256(refreshToken) },
    {
      $set: {
        refresh_token_hash: null,
        refresh_token_expires_at: null,
        refresh_token_ip: null,
        refresh_token_device: null
      }
    }
  );

  if (result.matchedCount === 0) {
    throw new Error('Invalid refresh token');
  }
}

/* ================= resend mail confirm================ */
export async function resendEmailVerificationService(email) {
  const user = await User.findOne(
    { email: email.toLowerCase() },
    { _id: 1, isMailVerified: 1 }
  ).lean();

  if (!user) {
    throw new Error('User not found');
  }

  if (user.isMailVerified) {
    throw new Error('Email already verified');
  }

  const auth = await Auth.findOne({ user_id: user._id });
  if (!auth) {
    throw new Error('Auth record not found');
  }

  const token = randomToken();

  await Auth.updateOne(
    { _id: auth._id },
    {
      $set: {
        email_verify_token_hash: sha256(token),
        email_verify_token_expires_at: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        )
      }
    }
  );

  sendEmailVerificationMail(
    email,
    `${process.env.FRONTEND_URL}/verify-email?token=${token}`
  ).catch(() => {});

  return {
    user_id: user._id,
    message: 'Confirmation email resent'
  };
}

/* ================= ADMIN SIGNUP (BOOTSTRAP) ================= */
export async function adminSignupService({
  email,
  phone,
  name,
  password,
  confirmPassword,
  signup_ip,
  isMailVerified = true,
  kycStatus,
  profile = {},
  actorId = null,
  userType,
  brokerId = null,
}) {
  if (!email || typeof email !== 'string') {
    throw new Error('Email is required');
  }

  if (!password || typeof password !== 'string') {
    throw new Error('Password is required');
  }

  if (!confirmPassword || typeof confirmPassword !== 'string') {
    throw new Error('Confirm password is required');
  }

  if (password !== confirmPassword) {
    throw new Error('Password and confirm password do not match');
  }

  const emailNormalized = email.toLowerCase().trim();

  const phoneNormalized =
    typeof phone === 'string' ? phone.trim() : phone;

  const safePhone =
    typeof phoneNormalized === 'string' && phoneNormalized.length === 0
      ? undefined
      : phoneNormalized;

  const safeName = typeof name === 'string' ? name.trim() : name;

  const allowedKycStatus = new Set([
    'NOT_STARTED',
    'PENDING',
    'VERIFIED',
    'REJECTED'
  ]);

  const safeKycStatus =
    typeof kycStatus === 'string'
      ? kycStatus.trim().toUpperCase()
      : undefined;

  if (safeKycStatus && !allowedKycStatus.has(safeKycStatus)) {
    throw new Error('Invalid kycStatus');
  }

  const safeUserTypeRaw =
    typeof userType === 'string' ? userType.trim().toUpperCase() : undefined;

  if (safeUserTypeRaw && safeUserTypeRaw !== 'USER') {
    throw new Error('Only USER can be created via this endpoint');
  }

  const finalUserType = 'USER';
  const mailVerified = Boolean(isMailVerified);

  let resolvedBrokerId = null;
  if (brokerId) {
    const id = String(brokerId).trim();
    if (!mongoose.isValidObjectId(id)) {
      throw new Error('Invalid brokerId');
    }
    resolvedBrokerId = id;
  }

  let user = null;
  let verifyToken = null;

  try {
    user = await User.create({
      email: emailNormalized,
      phone: safePhone,
      name: safeName,
      signup_ip,
      userType: finalUserType,
      isMailVerified: mailVerified,
      ...(resolvedBrokerId ? { brokerId: resolvedBrokerId } : {}),
      ...(safeKycStatus ? { kycStatus: safeKycStatus } : {})
    });

    const passwordHash = await hashPassword(password);

    const authPayload = {
      user_id: user._id,
      password_hash: passwordHash
    };

    if (!mailVerified) {
      verifyToken = randomToken();
      authPayload.email_verify_token_hash = sha256(verifyToken);
      authPayload.email_verify_token_expires_at = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      );
    }

    await Auth.create(authPayload);

    await Referral.create({
      user_id: user._id,
      referral_code: generateReferralCode(),
      referred_by: null,
      status: 'CONFIRMED'
    });

    const safeProfile =
      profile && typeof profile === 'object' ? profile : {};

    await UserProfile.create({
      user_id: user._id,
      date_of_birth: safeProfile.date_of_birth ?? null,
      gender: safeProfile.gender ?? null,
      address_line_1: safeProfile.address_line_1 ?? '',
      address_line_2: safeProfile.address_line_2 ?? '',
      city: safeProfile.city ?? '',
      state: safeProfile.state ?? '',
      country: safeProfile.country ?? '',
      pincode: safeProfile.pincode ?? ''
    });

    if (!mailVerified && verifyToken) {
      sendEmailVerificationMail(
        user.email,
        `${process.env.FRONTEND_URL}/verify-email?token=${verifyToken}`
      ).catch(err => {
        console.error('EMAIL SEND ERROR:', err);
      });
    }

    recordActivity({
      userId: user._id,
      action: ACTIVITY_ACTIONS.USER_CREATED,
      actorId: actorId || null,
      actorType: actorId ? ACTOR_TYPES.ADMIN : ACTOR_TYPES.SYSTEM
    }).catch(err => {
      console.error('ACTIVITY_LOG_ERROR:', err);
    });

    return {
      user_id: user._id,
      message: mailVerified
        ? 'User signup successful'
        : 'User signup successful, confirmation email sent'
    };
  } catch (err) {
    if (user?._id) {
      await Promise.allSettled([
        Auth.deleteOne({ user_id: user._id }),
        Referral.deleteOne({ user_id: user._id }),
        UserProfile.deleteOne({ user_id: user._id }),
        User.deleteOne({ _id: user._id })
      ]);
    }

    if (err && err.code === 11000) {
      throw new Error('Email or phone already exists');
    }

    throw err;
  }
}

/* ================= ADMIN CHANGE USER PASSWORD ================= */
export async function adminChangeUserPasswordService(
  userId,
  newPassword,
  actorId = null
) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error('Invalid userId');
  }

  if (!newPassword || typeof newPassword !== 'string') {
    throw new Error('New password is required');
  }

  const user = await User.findById(userId).select('_id').lean();
  if (!user) {
    throw new Error('User not found');
  }

  const passwordHash = await hashPassword(newPassword);

  const result = await Auth.updateOne(
    { user_id: userId },
    {
      $set: { password_hash: passwordHash, login_attempts: 0 },
      $unset: {
        reset_token_hash: 1,
        reset_token_expires_at: 1,
        refresh_token_hash: 1,
        refresh_token_expires_at: 1,
        refresh_token_ip: 1,
        refresh_token_device: 1
      }
    }
  );

  if (result.matchedCount === 0) {
    throw new Error('Auth record not found');
  }

  recordActivity({
    userId,
    action: ACTIVITY_ACTIONS.PASSWORD_CHANGED_BY_ADMIN,
    actorId: actorId || null,
    actorType: actorId ? ACTOR_TYPES.ADMIN : ACTOR_TYPES.SYSTEM
  }).catch(err => {
    console.error('ACTIVITY_LOG_ERROR:', err);
  });

  return { userId };
}

/* ================= USER CHANGE OWN PASSWORD ================= */
export async function changeMyPasswordService(userId, oldPassword, newPassword) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error('Invalid userId');
  }

  if (!oldPassword || typeof oldPassword !== 'string') {
    throw new Error('Old password is required');
  }

  if (!newPassword || typeof newPassword !== 'string') {
    throw new Error('New password is required');
  }

  if (oldPassword === newPassword) {
    throw new Error('New password must be different from old password');
  }

  const auth = await Auth.findOne({ user_id: userId });
  if (!auth) {
    throw new Error('Auth record not found');
  }

  const isOldPasswordValid = await comparePassword(oldPassword, auth.password_hash);
  if (!isOldPasswordValid) {
    throw new Error('Old password is incorrect');
  }

  const passwordHash = await hashPassword(newPassword);

  await Auth.updateOne(
    { _id: auth._id },
    {
      $set: {
        password_hash: passwordHash,
        login_attempts: 0
      },
      $unset: {
        reset_token_hash: 1,
        reset_token_expires_at: 1,
        refresh_token_hash: 1,
        refresh_token_expires_at: 1,
        refresh_token_ip: 1,
        refresh_token_device: 1
      }
    }
  );

  recordActivity({
    userId,
    action: ACTIVITY_ACTIONS.PASSWORD_CHANGED,
    actorId: userId,
    actorType: ACTOR_TYPES.SELF
  }).catch(err => {
    console.error('ACTIVITY_LOG_ERROR:', err);
  });

  return { userId };
}
