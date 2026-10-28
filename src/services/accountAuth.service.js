import mongoose from "mongoose";
import Account from "../models/Account.model.js";
import AccountAuth from "../models/AccountAuth.model.js";
import Broker from "../models/Broker.model.js";
import User from "../models/User.model.js";

import { comparePassword, sha256, hashPassword } from "../utils/hash.util.js";
import {
  signAccountToken,
  signAccountRefreshToken,
  verifyAccountRefreshToken,
} from "../utils/jwt.util.js";
import { sendAccountCreatedMail } from "../utils/mail.util.js";
import { generateStrongPassword } from "../utils/accountNumber.util.js";

/** App UI brand (never expose API host). From account → user broker. */
async function resolveBrokerBrand(account, user) {
  const brokerId = account?.brokerId || user?.brokerId || null;
  if (!brokerId) {
    return { brokerCode: "", brokerDisplayName: "" };
  }
  const broker = await Broker.findById(brokerId)
    .select("code displayName")
    .lean();
  return {
    brokerCode: broker?.code || "",
    brokerDisplayName: broker?.displayName || broker?.code || "",
  };
}

function isObjectIdString(value) {
  const id = String(value ?? "").trim();
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return false;
  return String(new mongoose.Types.ObjectId(id)) === id;
}

/** Resolve active account by Mongo _id or account_number. */
async function findActiveAccount(accountId, extraFilter = {}) {
  const id = String(accountId ?? "").trim();
  if (!id) return null;

  const or = [{ account_number: id }];
  if (isObjectIdString(id)) or.unshift({ _id: id });

  return Account.findOne({
    $or: or,
    status: "active",
    ...extraFilter,
  }).lean();
}

/**
 * Find AccountAuth by account_id or account_number.
 * Heals broken account_id links when found via account_number.
 */
async function findAccountAuthForAccount(account, selectFields = "") {
  if (!account?._id) return null;

  const query = {
    $or: [
      { account_id: account._id },
      { account_number: String(account.account_number) },
    ],
  };

  let q = AccountAuth.findOne(query);
  if (selectFields) q = q.select(selectFields);
  const auth = await q;

  if (!auth) return null;

  const needsHeal =
    String(auth.account_id) !== String(account._id) ||
    String(auth.account_number) !== String(account.account_number);

  if (needsHeal) {
    await AccountAuth.updateOne(
      { _id: auth._id },
      {
        $set: {
          account_id: account._id,
          account_number: account.account_number,
        },
      },
    );
    auth.account_id = account._id;
    auth.account_number = account.account_number;
  }

  return auth;
}

/** Create missing AccountAuth so reset/login works for orphaned trading accounts. */
async function createMissingAccountAuth(account, { tradeHash, watchHash }) {
  return AccountAuth.create({
    account_id: account._id,
    account_number: account.account_number,
    trade_password_hash: tradeHash,
    watch_password_hash: watchHash,
    login_attempts: 0,
    is_locked: false,
    credentials_created_at: new Date(),
    credentials_last_reset_at: new Date(),
  });
}

/* =====================================================
   ACCOUNT LOGIN (TRADE / WATCH)
===================================================== */
/** Login IDs: typed value, with/without "AC" prefix (users often skip AC). */
function accountNumberLoginCandidates(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/\s+/g, "");
  if (!s) return [];
  const upper = s.toUpperCase();
  const out = [s];
  if (upper.startsWith("AC") && s.length > 2) {
    out.push(s.slice(2));
  } else if (/^\d+$/.test(s)) {
    out.push(`AC${s}`);
  }
  return [...new Set(out)];
}

export async function accountLoginService({
  account_number,
  password,
  ip,
  device,
  fcmToken,
}) {
  if (!account_number || !password) {
    throw new Error("Invalid request");
  }

  const candidates = accountNumberLoginCandidates(account_number);
  let account = null;
  for (const num of candidates) {
    account = await Account.findOne({
      account_number: num,
      status: "active",
    }).lean();
    if (account) break;
  }

  if (!account) {
    throw new Error("Invalid credentials");
  }

  const auth = await findAccountAuthForAccount(
    account,
    "+trade_password_hash +watch_password_hash",
  );

  if (!auth || auth.is_locked) {
    throw new Error("Account auth not found or locked");
  }

  const tradeOk =
    Boolean(auth.trade_password_hash) &&
    (await comparePassword(password, auth.trade_password_hash));
  const watchOk =
    Boolean(auth.watch_password_hash) &&
    (await comparePassword(password, auth.watch_password_hash));

  // Security: trade & watch passwords must never be the same.
  // If the same password matches both hashes, the account is misconfigured.
  if (tradeOk && watchOk) {
    throw new Error(
      "Trade and watch passwords must be different. Please reset one of them",
    );
  }

  let sessionType = null;
  if (tradeOk) sessionType = "TRADE";
  else if (watchOk) sessionType = "WATCH";

  if (!sessionType) {
    await AccountAuth.updateOne(
      { _id: auth._id },
      { $inc: { login_attempts: 1 } }
    );

    throw new Error("Invalid credentials");
  }

  const tokenPayload = {
    accountId: account._id.toString(),
    userId: account.user_id.toString(),
    account_number: account.account_number,
    sessionType,
  };

  const tradeToken = signAccountToken(tokenPayload);
  const refreshToken = signAccountRefreshToken(tokenPayload);

  await AccountAuth.updateOne(
    { _id: auth._id },
    {
      $set: {
        login_attempts: 0,

        last_login_at: new Date(),
        last_login_ip: ip || null,
        last_login_device: device || null,

        // ✅ FCM TOKEN SAVE
        fcm_token: fcmToken || null,

        access_token_hash: sha256(tradeToken),
        access_token_expires_at: new Date(
          Date.now() + 15 * 60 * 1000
        ),
        refresh_token_hash: sha256(refreshToken),
        refresh_token_expires_at: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ),
      },
    }
  );

  const user = await User.findById(account.user_id)
    .select("name email brokerId")
    .lean();
  const brand = await resolveBrokerBrand(account, user);

  return {
    tradeToken,
    refreshToken,
    sessionType,
    accountId: account._id.toString(),
    account_number: account.account_number,
    account_type: account.account_type,
    // Account holder ka naam (app sidebar me number ki jagah
    // naam dikhane ke liye).
    name: user?.name || "",
    email: user?.email || "",
    brokerCode: brand.brokerCode,
    brokerDisplayName: brand.brokerDisplayName,
  };
}

/* =====================================================
   REFRESH SESSION (APP AUTO-LOGIN)
   Access token 12h me expire hota hai; refresh token
   (30 din, DB me hash stored, har use pe rotate) se app
   bina password dobara login kiye naya token le sakta hai.
===================================================== */
export async function refreshAccountSessionService({ refreshToken }) {
  if (!refreshToken) {
    throw new Error("Refresh token required");
  }

  let decoded;
  try {
    decoded = verifyAccountRefreshToken(String(refreshToken));
  } catch {
    throw new Error("Session expired. Please login again");
  }

  const account = await Account.findOne({
    _id: decoded.accountId,
    status: "active",
  }).lean();
  if (!account) {
    throw new Error("Session expired. Please login again");
  }

  const auth = await AccountAuth.findOne({
    account_id: account._id,
    is_locked: false,
  }).select("+refresh_token_hash");
  if (!auth || !auth.refresh_token_hash) {
    throw new Error("Session expired. Please login again");
  }

  if (auth.refresh_token_hash !== sha256(String(refreshToken))) {
    throw new Error("Session expired. Please login again");
  }
  if (
    auth.refresh_token_expires_at &&
    new Date(auth.refresh_token_expires_at).getTime() < Date.now()
  ) {
    throw new Error("Session expired. Please login again");
  }
  // Password reset ke baad purane refresh tokens bhi invalid.
  if (auth.credentials_last_reset_at && decoded.iat) {
    const resetAtSec = Math.floor(
      new Date(auth.credentials_last_reset_at).getTime() / 1000
    );
    if (Number(decoded.iat) < resetAtSec) {
      throw new Error("Session expired. Please login again");
    }
  }

  const tokenPayload = {
    accountId: account._id.toString(),
    userId: account.user_id.toString(),
    account_number: account.account_number,
    sessionType: decoded.sessionType,
  };

  const tradeToken = signAccountToken(tokenPayload);
  const newRefreshToken = signAccountRefreshToken(tokenPayload);

  await AccountAuth.updateOne(
    { _id: auth._id },
    {
      $set: {
        access_token_hash: sha256(tradeToken),
        access_token_expires_at: new Date(Date.now() + 15 * 60 * 1000),
        refresh_token_hash: sha256(newRefreshToken),
        refresh_token_expires_at: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ),
      },
    }
  );

  const user = await User.findById(account.user_id)
    .select("name email brokerId")
    .lean();
  const brand = await resolveBrokerBrand(account, user);

  return {
    tradeToken,
    refreshToken: newRefreshToken,
    sessionType: decoded.sessionType,
    accountId: account._id.toString(),
    account_number: account.account_number,
    account_type: account.account_type,
    name: user?.name || "",
    email: user?.email || "",
    brokerCode: brand.brokerCode,
    brokerDisplayName: brand.brokerDisplayName,
  };
}

/* =====================================================
   ACCOUNT PROFILE (NAME ETC. FOR APP SIDEBAR)
===================================================== */
export async function getAccountProfileService({ accountId }) {
  const account = await Account.findById(accountId).lean();
  if (!account) {
    throw new Error("Account not found");
  }
  const user = await User.findById(account.user_id)
    .select("name email brokerId")
    .lean();
  const brand = await resolveBrokerBrand(account, user);
  return {
    accountId: account._id.toString(),
    account_number: account.account_number,
    account_type: account.account_type,
    name: user?.name || "",
    email: user?.email || "",
    brokerCode: brand.brokerCode,
    brokerDisplayName: brand.brokerDisplayName,
  };
}

/* =====================================================
   RESET TRADE PASSWORD (USER SETS PASSWORD)
===================================================== */
export async function resetTradePasswordService({
  userId,
  accountId,
  newPassword,
}) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const account = await findActiveAccount(accountId, { user_id: userId });

  if (!account) {
    throw new Error("Account not found or inactive");
  }

  let auth = await findAccountAuthForAccount(
    account,
    "+watch_password_hash",
  );

  const newPasswordHash = await hashPassword(newPassword);
  let watchPasswordForMail = "UNCHANGED";

  if (!auth) {
    let watchPass = generateStrongPassword(12);
    while (watchPass === newPassword) {
      watchPass = generateStrongPassword(12);
    }
    const watchHash = await hashPassword(watchPass);
    auth = await createMissingAccountAuth(account, {
      tradeHash: newPasswordHash,
      watchHash,
    });
    watchPasswordForMail = watchPass;
  } else {
    if (
      auth.watch_password_hash &&
      (await comparePassword(newPassword, auth.watch_password_hash))
    ) {
      throw new Error("Trade password must be different from watch password");
    }

    await AccountAuth.updateOne(
      { _id: auth._id },
      {
        $set: {
          trade_password_hash: newPasswordHash,
          credentials_last_reset_at: new Date(),
          access_token_hash: null,
          access_token_expires_at: null,
          refresh_token_hash: null,
          refresh_token_expires_at: null,
          login_attempts: 0,
          is_locked: false,
        },
      },
    );
  }

  // optional email alert (no password inside unless auth was bootstrapped)
  const user = await User.findById(userId, { email: 1 }).lean();
  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: "UPDATED BY USER",
      watchPassword: watchPasswordForMail,
    }).catch(() => {});
  }

  return { message: "Trade password updated successfully" };
}

/* =====================================================
   RESET WATCH PASSWORD (USER SETS PASSWORD)
===================================================== */
export async function resetWatchPasswordService({
  userId,
  accountId,
  newPassword,
}) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const account = await findActiveAccount(accountId, { user_id: userId });

  if (!account) {
    throw new Error("Account not found or inactive");
  }

  let auth = await findAccountAuthForAccount(
    account,
    "+trade_password_hash",
  );

  const newPasswordHash = await hashPassword(newPassword);
  let tradePasswordForMail = "UNCHANGED";

  if (!auth) {
    let tradePass = generateStrongPassword(12);
    while (tradePass === newPassword) {
      tradePass = generateStrongPassword(12);
    }
    const tradeHash = await hashPassword(tradePass);
    auth = await createMissingAccountAuth(account, {
      tradeHash,
      watchHash: newPasswordHash,
    });
    tradePasswordForMail = tradePass;
  } else {
    if (
      auth.trade_password_hash &&
      (await comparePassword(newPassword, auth.trade_password_hash))
    ) {
      throw new Error("Watch password must be different from trade password");
    }

    await AccountAuth.updateOne(
      { _id: auth._id },
      {
        $set: {
          watch_password_hash: newPasswordHash,
          credentials_last_reset_at: new Date(),
          access_token_hash: null,
          access_token_expires_at: null,
          refresh_token_hash: null,
          refresh_token_expires_at: null,
          login_attempts: 0,
          is_locked: false,
        },
      },
    );
  }

  // optional email alert (no password inside unless auth was bootstrapped)
  const user = await User.findById(userId, { email: 1 }).lean();
  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: tradePasswordForMail,
      watchPassword: "UPDATED BY USER",
    }).catch(() => {});
  }

  return { message: "Watch password updated successfully" };
}

/* =====================================================
   ADMIN RESET TRADE PASSWORD
===================================================== */
export async function adminResetTradePasswordService({
  accountId,
  newPassword,
}) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const account = await findActiveAccount(accountId);

  if (!account) {
    throw new Error("Account not found or inactive");
  }

  let auth = await findAccountAuthForAccount(
    account,
    "+watch_password_hash",
  );

  const newPasswordHash = await hashPassword(newPassword);
  let watchPasswordForMail = "UNCHANGED";

  if (!auth) {
    let watchPass = generateStrongPassword(12);
    while (watchPass === newPassword) {
      watchPass = generateStrongPassword(12);
    }
    const watchHash = await hashPassword(watchPass);
    auth = await createMissingAccountAuth(account, {
      tradeHash: newPasswordHash,
      watchHash,
    });
    watchPasswordForMail = watchPass;
  } else {
    // Prevent privilege confusion: WATCH password must never work as TRADE password.
    if (
      auth.watch_password_hash &&
      (await comparePassword(newPassword, auth.watch_password_hash))
    ) {
      throw new Error("Trade password must be different from watch password");
    }

    await AccountAuth.updateOne(
      { _id: auth._id },
      {
        $set: {
          trade_password_hash: newPasswordHash,
          credentials_last_reset_at: new Date(),
          access_token_hash: null,
          access_token_expires_at: null,
          refresh_token_hash: null,
          refresh_token_expires_at: null,
          login_attempts: 0,
          is_locked: false,
        },
      },
    );
  }

  const user = await User.findById(account.user_id, { email: 1 }).lean();
  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: newPassword,
      watchPassword: watchPasswordForMail,
    }).catch(() => {});
  }

  return { message: "Trade password updated successfully" };
}

/* =====================================================
   ADMIN RESET WATCH PASSWORD
===================================================== */
export async function adminResetWatchPasswordService({
  accountId,
  newPassword,
}) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  const account = await findActiveAccount(accountId);

  if (!account) {
    throw new Error("Account not found or inactive");
  }

  let auth = await findAccountAuthForAccount(
    account,
    "+trade_password_hash",
  );

  const newPasswordHash = await hashPassword(newPassword);
  let tradePasswordForMail = "UNCHANGED";

  if (!auth) {
    let tradePass = generateStrongPassword(12);
    while (tradePass === newPassword) {
      tradePass = generateStrongPassword(12);
    }
    const tradeHash = await hashPassword(tradePass);
    auth = await createMissingAccountAuth(account, {
      tradeHash,
      watchHash: newPasswordHash,
    });
    tradePasswordForMail = tradePass;
  } else {
    // Prevent privilege confusion: TRADE password must never work as WATCH password.
    if (
      auth.trade_password_hash &&
      (await comparePassword(newPassword, auth.trade_password_hash))
    ) {
      throw new Error("Watch password must be different from trade password");
    }

    await AccountAuth.updateOne(
      { _id: auth._id },
      {
        $set: {
          watch_password_hash: newPasswordHash,
          credentials_last_reset_at: new Date(),
          access_token_hash: null,
          access_token_expires_at: null,
          refresh_token_hash: null,
          refresh_token_expires_at: null,
          login_attempts: 0,
          is_locked: false,
        },
      },
    );
  }

  const user = await User.findById(account.user_id, { email: 1 }).lean();
  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: tradePasswordForMail,
      watchPassword: newPassword,
    }).catch(() => {});
  }

  return { message: "Watch password updated successfully" };
}
