import mongoose from 'mongoose';
import User from '../models/User.model.js';
import UserProfile from '../models/UserProfile.model.js';
import Kyc from '../models/Kyc.model.js';
import Auth from '../models/Auth.model.js';
import Referral from '../models/Referral.model.js';
import UserDevice from '../models/UserDevice.model.js';
import Otp from '../models/Otp.model.js';
import ActivityLog from '../models/ActivityLog.model.js';
import ReferralReward from '../models/ReferralReward.model.js';
import Account from '../models/Account.model.js';
import Trade from '../models/Trade.model.js';
import PendingOrder from '../models/PendingOrder.model.js';
import Brokerage from '../models/Brokerage.model.js';
import Transaction from '../models/Transaction.model.js';
import Deposit from '../models/Deposit.model.js';
import Withdrawal from '../models/Withdrawal.model.js';
import WatchlistItem from '../models/watchlistItem.model.js';
import { adminDeleteAccountService } from './account.service.js';

// search users by name or email
export async function searchUsersService(query = {}) {
  const q = String(query.q || '').trim();
  const limitRaw = Number(query.limit || 20);
  const limit = Math.min(Math.max(limitRaw, 1), 50);

  if (!q) {
    throw new Error('Search query is required');
  }

  const filter = {
    $or: [
      { email: { $regex: q, $options: 'i' } },
      { name: { $regex: q, $options: 'i' } }
    ]
  };

  const users = await User.find(filter)
    .select('_id name email phone userType isMailVerified kycStatus createdAt isOnline lastSeenAt')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return users;
}
// get my profile details by user
export async function getMyProfileService(userId) {
  const result = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(userId)
      }
    },
    {
      $lookup: {
        from: 'userprofiles',
        localField: '_id',
        foreignField: 'user_id',
        as: 'profile'
      }
    },
    {
      $unwind: {
        path: '$profile',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $project: {
        _id: 1,
        email: 1,
        phone: 1,
        name: 1,
        isMailVerified: 1,
        kycStatus: 1,

        date_of_birth: '$profile.date_of_birth',
        gender: '$profile.gender',
        address_line_1: '$profile.address_line_1',
        address_line_2: '$profile.address_line_2',
        city: '$profile.city',
        state: '$profile.state',
        country: '$profile.country',
        pincode: '$profile.pincode'
      }
    }
  ]);

  return result.length ? result[0] : null;
}
// update my profile details by user
export async function updateMyProfileService(userId, payload = {}) {
  console.log('UPDATE PROFILE SERVICE CALLED');
  console.log('USER ID =>', userId);
  console.log('PAYLOAD =>', payload);

  const allowedData = {
    date_of_birth: payload.date_of_birth ?? null,
    gender: payload.gender ?? null,
    address_line_1: payload.address_line_1 ?? '',
    address_line_2: payload.address_line_2 ?? '',
    city: payload.city ?? '',
    state: payload.state ?? '',
    country: payload.country ?? '',
    pincode: payload.pincode ?? ''
  };

  console.log('ALLOWED DATA =>', allowedData);

  const profile = await UserProfile.findOneAndUpdate(
    { user_id: userId },
    { $set: allowedData },
    {
      new: true,
      upsert: true,
      lean: true
    }
  );

  console.log('UPDATED PROFILE =>', profile);

  return profile;
}

export async function adminUpdateUserService(userId, payload = {}) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error('Invalid userId');
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Request body is required');
  }

  const {
    email,
    name,
    phone,
    userType,
    isMailVerified,
    kycStatus,
    kycRejectionReason,
    date_of_birth,
    gender,
    address_line_1,
    address_line_2,
    city,
    state,
    country,
    pincode
  } = payload;

  if (email !== undefined) {
    throw new Error('Email cannot be updated');
  }

  const userUpdate = {};

  if (name !== undefined) userUpdate.name = name;
  if (phone !== undefined) userUpdate.phone = phone;
  if (userType !== undefined) userUpdate.userType = userType;
  if (isMailVerified !== undefined) userUpdate.isMailVerified = isMailVerified;
  if (kycStatus !== undefined) userUpdate.kycStatus = kycStatus;

  const profileUpdate = {};

  if (date_of_birth !== undefined) profileUpdate.date_of_birth = date_of_birth;
  if (gender !== undefined) profileUpdate.gender = gender;
  if (address_line_1 !== undefined) profileUpdate.address_line_1 = address_line_1;
  if (address_line_2 !== undefined) profileUpdate.address_line_2 = address_line_2;
  if (city !== undefined) profileUpdate.city = city;
  if (state !== undefined) profileUpdate.state = state;
  if (country !== undefined) profileUpdate.country = country;
  if (pincode !== undefined) profileUpdate.pincode = pincode;

  const session = await mongoose.startSession();

  try {
    let updatedUser = null;
    let updatedProfile = null;
    let updatedKyc = null;

    const normalizeKyc = (value) =>
      String(value || '')
        .trim()
        .toUpperCase();

    const ALLOWED_KYC = new Set([
      'NOT_STARTED',
      'PENDING',
      'VERIFIED',
      'REJECTED'
    ]);

    if (userUpdate.kycStatus !== undefined) {
      const normalized = normalizeKyc(userUpdate.kycStatus);
      if (!ALLOWED_KYC.has(normalized)) {
        throw new Error('Invalid kycStatus');
      }
      userUpdate.kycStatus = normalized;
    }

    await session.withTransaction(async () => {
      if (Object.keys(userUpdate).length > 0) {
        updatedUser = await User.findByIdAndUpdate(
          userId,
          { $set: userUpdate },
          { new: true, runValidators: true, session }
        ).lean();
      } else {
        updatedUser = await User.findById(userId).lean();
      }

      if (!updatedUser) {
        throw new Error('User not found');
      }

      // Keep KYC model in sync when admin updates `user.kycStatus` via this endpoint.
      // - NOT_STARTED => delete KYC doc (if exists)
      // - PENDING/VERIFIED/REJECTED => update existing KYC doc status
      if (kycStatus !== undefined) {
        const next = normalizeKyc(kycStatus);

        if (!ALLOWED_KYC.has(next)) {
          throw new Error('Invalid kycStatus');
        }

        if (next === 'NOT_STARTED') {
          await Kyc.deleteOne({ user: userId }, { session });
          updatedKyc = null;
        } else {
          const reason =
            next === 'REJECTED'
              ? String(kycRejectionReason || 'Rejected by admin').trim()
              : '';

          // If KYC record doesn't exist, create it (admin override).
          // Documents may be empty in this case, but status will be consistent with User.kycStatus.
          updatedKyc = await Kyc.findOneAndUpdate(
            { user: userId },
            {
              $set: {
                status: next,
                rejectionReason: reason
              },
              $setOnInsert: {
                user: userId,
                source: 'ADMIN',
                documents: {
                  front: { image_url: '', image_public_id: '' },
                  back: { image_url: '', image_public_id: '' },
                  selfie: { image_url: '', image_public_id: '' }
                }
              }
            },
            { new: true, upsert: true, runValidators: true, session }
          ).lean();
        }
      }

      if (Object.keys(profileUpdate).length > 0) {
        updatedProfile = await UserProfile.findOneAndUpdate(
          { user_id: userId },
          { $set: profileUpdate },
          { new: true, upsert: true, runValidators: true, session }
        ).lean();
      } else {
        updatedProfile = await UserProfile.findOne({ user_id: userId }).lean();
      }
    });

    return {
      user: updatedUser,
      profile: updatedProfile,
      kyc: updatedKyc
    };
  } finally {
    session.endSession();
  }
}

export async function adminListUsersService(query = {}) {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 10;
  const skip = (page - 1) * limit;

  const filter = {};

  const q = String(query.q || "").trim();
  if (q) {
    filter.$or = [
      { name: { $regex: q, $options: "i" } },
      { email: { $regex: q, $options: "i" } },
      { phone: { $regex: q, $options: "i" } }
    ];
  }

  if (typeof query.userType === "string" && query.userType.trim()) {
    filter.userType = query.userType.trim().toUpperCase();
  }

  if (typeof query.isMailVerified === "string") {
    if (query.isMailVerified === "true") filter.isMailVerified = true;
    if (query.isMailVerified === "false") filter.isMailVerified = false;
  }

  if (typeof query.kycStatus === "string" && query.kycStatus.trim()) {
    filter.kycStatus = query.kycStatus.trim().toUpperCase();
  }

  const [items, total] = await Promise.all([
    User.find(filter)
      .select(
        "_id name email phone userType isMailVerified kycStatus createdAt isOnline lastSeenAt"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter)
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

// admin: get single user profile by userId
export async function adminGetUserProfileService(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error('Invalid userId');
  }

  const result = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(userId)
      }
    },
    {
      $lookup: {
        from: 'userprofiles',
        localField: '_id',
        foreignField: 'user_id',
        as: 'profile'
      }
    },
    {
      $unwind: {
        path: '$profile',
        preserveNullAndEmptyArrays: true
      }
    },
    {
      $project: {
        _id: 1,
        email: 1,
        phone: 1,
        name: 1,
        userType: 1,
        isMailVerified: 1,
        kycStatus: 1,
        createdAt: 1,
        isOnline: 1,
        lastSeenAt: 1,

        date_of_birth: '$profile.date_of_birth',
        gender: '$profile.gender',
        address_line_1: '$profile.address_line_1',
        address_line_2: '$profile.address_line_2',
        city: '$profile.city',
        state: '$profile.state',
        country: '$profile.country',
        pincode: '$profile.pincode'
      }
    }
  ]);

  return result.length ? result[0] : null;
}

export async function adminDeleteUserService(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error('Invalid userId');
  }

  const user = await User.findById(userId).select('_id').lean();
  if (!user) {
    throw new Error('User not found');
  }

  const accounts = await Account.find({ user_id: userId }).select('_id').lean();
  const accountIds = accounts.map((item) => item._id);

  for (const accountId of accountIds) {
    await adminDeleteAccountService({
      accountId: String(accountId),
      userId: String(userId),
    });
  }

  await Promise.all([
    Auth.deleteOne({ user_id: userId }),
    Referral.deleteOne({ user_id: userId }),
    UserProfile.deleteOne({ user_id: userId }),
    Kyc.deleteOne({ user: userId }),
    UserDevice.deleteMany({ user_id: userId }),
    Otp.deleteMany({ user_id: userId }),
    ActivityLog.deleteMany({
      $or: [{ user_id: userId }, { actor_id: userId }],
    }),
    ReferralReward.deleteMany({
      $or: [{ referred_user: userId }, { referrer_user: userId }],
    }),
    Trade.deleteMany({ userId }),
    PendingOrder.deleteMany({ userId }),
    Brokerage.deleteMany({ user_id: userId }),
    Transaction.deleteMany({ user: userId }),
    Deposit.deleteMany({ user: userId }),
    Withdrawal.deleteMany({ user: userId }),
    WatchlistItem.deleteMany({ userId }),
    User.deleteOne({ _id: userId }),
  ]);

  return {
    userId: String(userId),
    deletedAccounts: accountIds.length,
  };
}
