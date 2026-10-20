import Account from "../models/Account.model.js";
import AccountAuth from "../models/AccountAuth.model.js";
import User from "../models/User.model.js";

import { comparePassword, sha256, hashPassword } from "../utils/hash.util.js";
import { signAccountToken } from "../utils/jwt.util.js";
import { sendAccountCreatedMail } from "../utils/mail.util.js";

/* =====================================================
   ACCOUNT LOGIN (TRADE / WATCH)
===================================================== */
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

  const account = await Account.findOne({
    account_number,
    status: "active",
  }).lean();

  if (!account) {
    throw new Error("Invalid credentials");
  }

  const auth = await AccountAuth.findOne({
    account_id: account._id,
    is_locked: false,
  }).select("+trade_password_hash +watch_password_hash");

  if (!auth) {
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
      },
    }
  );

  const user = await User.findById(account.user_id)
    .select("name email")
    .lean();

  return {
    tradeToken,
    sessionType,
    accountId: account._id.toString(),
    account_number: account.account_number,
    account_type: account.account_type,
    // Account holder ka naam (app sidebar me number ki jagah
    // naam dikhane ke liye).
    name: user?.name || "",
    email: user?.email || "",
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
    .select("name email")
    .lean();
  return {
    accountId: account._id.toString(),
    account_number: account.account_number,
    account_type: account.account_type,
    name: user?.name || "",
    email: user?.email || "",
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

  const account = await Account.findOne({
    _id: accountId,
    user_id: userId,
    status: "active",
  }).lean();

  if (!account) {
    throw new Error("Account not found or inactive");
  }

  const auth = await AccountAuth.findOne({
    account_id: account._id,
  }).select("+watch_password_hash");

  if (!auth) {
    throw new Error("Account auth not found");
  }

  if (
    auth.watch_password_hash &&
    (await comparePassword(newPassword, auth.watch_password_hash))
  ) {
    throw new Error("Trade password must be different from watch password");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await AccountAuth.updateOne(
    { _id: auth._id },
    {
      $set: {
        trade_password_hash: newPasswordHash,
        credentials_last_reset_at: new Date(),
        access_token_hash: null,
        access_token_expires_at: null,
        login_attempts: 0,
      },
    }
  );

  // optional email alert (no password inside)
  const user = await User.findById(userId, { email: 1 }).lean();
  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: "UPDATED BY USER",
      watchPassword: "UNCHANGED",
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

  const account = await Account.findOne({
    _id: accountId,
    user_id: userId,
    status: "active",
  }).lean();

  if (!account) {
    throw new Error("Account not found or inactive");
  }

  const auth = await AccountAuth.findOne({
    account_id: account._id,
  }).select("+trade_password_hash");

  if (!auth) {
    throw new Error("Account auth not found");
  }

  if (
    auth.trade_password_hash &&
    (await comparePassword(newPassword, auth.trade_password_hash))
  ) {
    throw new Error("Watch password must be different from trade password");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await AccountAuth.updateOne(
    { _id: auth._id },
    {
      $set: {
        watch_password_hash: newPasswordHash,
        credentials_last_reset_at: new Date(),
        access_token_hash: null,
        access_token_expires_at: null,
        login_attempts: 0,
      },
    }
  );

  // optional email alert (no password inside)
  const user = await User.findById(userId, { email: 1 }).lean();
  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: "UNCHANGED",
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

  const account = await Account.findOne({
    _id: accountId,
    status: "active",
  }).lean();

  if (!account) {
    throw new Error("Account not found or inactive");
  }

  const auth = await AccountAuth.findOne({
    account_id: account._id,
  }).select("+watch_password_hash");

  if (!auth) {
    throw new Error("Account auth not found");
  }

  // Prevent privilege confusion: WATCH password must never work as TRADE password.
  if (
    auth.watch_password_hash &&
    (await comparePassword(newPassword, auth.watch_password_hash))
  ) {
    throw new Error("Trade password must be different from watch password");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await AccountAuth.updateOne(
    { _id: auth._id },
    {
      $set: {
        trade_password_hash: newPasswordHash,
        credentials_last_reset_at: new Date(),
        access_token_hash: null,
        access_token_expires_at: null,
        login_attempts: 0,
      },
    }
  );

  const user = await User.findById(account.user_id, { email: 1 }).lean();
  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: newPassword,
      watchPassword: "UNCHANGED",
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

  const account = await Account.findOne({
    _id: accountId,
    status: "active",
  }).lean();

  if (!account) {
    throw new Error("Account not found or inactive");
  }

  const auth = await AccountAuth.findOne({
    account_id: account._id,
  }).select("+trade_password_hash");

  if (!auth) {
    throw new Error("Account auth not found");
  }

  // Prevent privilege confusion: TRADE password must never work as WATCH password.
  if (
    auth.trade_password_hash &&
    (await comparePassword(newPassword, auth.trade_password_hash))
  ) {
    throw new Error("Watch password must be different from trade password");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await AccountAuth.updateOne(
    { _id: auth._id },
    {
      $set: {
        watch_password_hash: newPasswordHash,
        credentials_last_reset_at: new Date(),
        access_token_hash: null,
        access_token_expires_at: null,
        login_attempts: 0,
      },
    }
  );

  const user = await User.findById(account.user_id, { email: 1 }).lean();
  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: "UNCHANGED",
      watchPassword: newPassword,
    }).catch(() => {});
  }

  return { message: "Watch password updated successfully" };
}
