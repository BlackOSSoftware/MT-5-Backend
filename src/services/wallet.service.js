import mongoose from "mongoose";

import User from "../models/User.model.js";
import Account from "../models/Account.model.js";
import AccountPlan from "../models/AccountPlan.model.js";
import Trade from "../models/Trade.model.js";
import Transaction from "../models/Transaction.model.js";
import Withdrawal from "../models/Withdrawal.model.js";
import WalletTransaction from "../models/WalletTransaction.model.js";

import EngineSync from "../trade-engine/EngineSync.js";
import { publishAccountBalance } from "../trade-engine/EngineSyncBus.js";
import { getWithdrawableBalance } from "../utils/nonWithdrawable.util.js";
import { getUserBrokerId } from "../utils/brokerScope.js";
import { assertWithdrawMethodEnabled } from "./withdrawMethod.service.js";
import { validatePayout, buildPayoutSnapshot } from "./withdrawal.service.js";

/* =====================================================
   HELPERS
===================================================== */

const MIN_TRANSFER = 1;
const MAX_TRANSFER = 50000;

function publicError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isPublic = true;
  return err;
}

function isValidAmount(amount) {
  return typeof amount === "number" && Number.isFinite(amount);
}

function hasMaxTwoDecimals(amount) {
  return Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-9;
}

function validateTransferAmount(amount) {
  if (!isValidAmount(amount)) throw publicError("Invalid amount");
  if (amount <= 0) throw publicError("Amount must be greater than 0");
  if (!hasMaxTwoDecimals(amount)) {
    throw publicError("Max 2 decimal places allowed");
  }
  if (amount < MIN_TRANSFER) throw publicError(`Minimum $${MIN_TRANSFER}`);
  if (amount > MAX_TRANSFER) throw publicError(`Maximum $${MAX_TRANSFER}`);
}

function walletAvailable(user) {
  const balance = Number(user?.wallet_balance || 0);
  const hold = Number(user?.wallet_hold_balance || 0);
  return Math.max(0, balance - hold);
}

async function getUserOrThrow(userId, session) {
  const user = await User.findById(userId).session(session || null);
  if (!user) throw publicError("User not found", 404);
  return user;
}

async function getOwnedLiveAccount(accountId, userId, session) {
  if (!mongoose.isValidObjectId(accountId)) {
    throw publicError("Invalid account id");
  }
  const account = await Account.findOne({
    _id: accountId,
    user_id: userId,
    status: "active",
  }).session(session);
  if (!account) throw publicError("Account not found");
  if (account.account_type !== "live") {
    throw publicError("Wallet transfers are allowed only with live accounts");
  }
  return account;
}

/* =====================================================
   WALLET SUMMARY
===================================================== */

export async function getWalletService({ userId }) {
  const user = await User.findById(userId)
    .select("wallet_balance wallet_hold_balance")
    .lean();

  if (!user) throw publicError("User not found", 404);

  const balance = Number(user.wallet_balance || 0);
  const hold = Number(user.wallet_hold_balance || 0);

  const transactions = await WalletTransaction.find({ user: userId })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate("account", "account_number account_type")
    .lean();

  const pendingWithdrawals = await Withdrawal.countDocuments({
    user: userId,
    source: "WALLET",
    status: { $in: ["PENDING", "APPROVED", "PROCESSING"] },
  });

  return {
    balance,
    holdBalance: hold,
    availableBalance: Math.max(0, balance - hold),
    pendingWithdrawals,
    transactions,
  };
}

/* =====================================================
   WALLET TRANSACTION HISTORY
===================================================== */

export async function listWalletTransactionsService({
  userId,
  page = 1,
  limit = 10,
}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const skip = (safePage - 1) * safeLimit;

  const filter = { user: userId };

  const [data, total] = await Promise.all([
    WalletTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("account", "account_number account_type status")
      .lean(),
    WalletTransaction.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

/* =====================================================
   WALLET <-> TRADING ACCOUNT TRANSFER
   direction: "TO_ACCOUNT"   wallet -> account
              "FROM_ACCOUNT" account -> wallet
===================================================== */

export async function transferWalletService({
  userId,
  direction,
  accountId,
  amount,
  ipAddress,
}) {
  if (!["TO_ACCOUNT", "FROM_ACCOUNT"].includes(direction)) {
    throw publicError("Invalid transfer direction");
  }
  if (!accountId) throw publicError("accountId is required");
  validateTransferAmount(amount);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await getUserOrThrow(userId, session);
    const account = await getOwnedLiveAccount(accountId, userId, session);

    let walletDelta = 0; // + credit, - debit
    let accountDelta = 0;
    let walletTxType = null;
    let accountTxType = null;
    let remark = "";

    if (direction === "TO_ACCOUNT") {
      // Wallet -> Account
      const available = walletAvailable(user);
      if (amount > available) {
        throw publicError(
          `Only $${available.toFixed(2)} is available in your wallet`,
        );
      }

      // Same rule as internal transfer: receiving account must have done first deposit.
      if (account.first_deposit === false) {
        const plan = await AccountPlan.findById(account.account_plan_id)
          .session(session)
          .lean();
        throw publicError(
          `Complete first deposit of $${plan?.minDeposit || 0} before receiving funds`,
        );
      }

      walletDelta = -amount;
      accountDelta = amount;
      walletTxType = "DEBIT";
      accountTxType = "INTERNAL_TRANSFER_IN";
      remark = "Wallet to trading account transfer";
    } else {
      // Account -> Wallet
      const openTrades = await Trade.countDocuments({
        accountId: account._id,
        status: "OPEN",
      }).session(session);

      if (openTrades > 0) {
        throw publicError("Transfer blocked: Close all open trades first");
      }

      const withdrawable = getWithdrawableBalance(account);
      if (amount > withdrawable) {
        throw publicError(
          `Only $${withdrawable.toFixed(2)} is transferable from this account`,
        );
      }

      walletDelta = amount;
      accountDelta = -amount;
      walletTxType = "CREDIT";
      accountTxType = "INTERNAL_TRANSFER_OUT";
      remark = "Trading account to wallet transfer";
    }

    /* ---------- apply wallet change ---------- */
    const newWalletBalance = Number(user.wallet_balance || 0) + walletDelta;
    if (newWalletBalance < 0) throw publicError("Insufficient wallet balance");

    await User.updateOne(
      { _id: user._id },
      { $set: { wallet_balance: newWalletBalance } },
      { session },
    );

    /* ---------- apply account change ---------- */
    const newAccountBalance = Number(account.balance || 0) + accountDelta;
    await Account.updateOne(
      { _id: account._id },
      {
        $set: {
          balance: newAccountBalance,
          equity: Number(newAccountBalance) + Number(account.bonus_balance || 0),
        },
      },
      { session },
    );

    /* ---------- ledger entries ---------- */
    const refId = new mongoose.Types.ObjectId();
    const newAvailable = Math.max(
      0,
      newWalletBalance - Number(user.wallet_hold_balance || 0),
    );

    await WalletTransaction.create(
      [
        {
          user: userId,
          type: walletTxType,
          amount,
          balanceAfter: newAvailable,
          status: "SUCCESS",
          referenceType: "INTERNAL_TRANSFER",
          referenceId: refId,
          account: account._id,
          createdBy: userId,
          remark,
          ipAddress: ipAddress || "",
        },
      ],
      { session },
    );

    await Transaction.create(
      [
        {
          user: userId,
          account: account._id,
          type: accountTxType,
          amount,
          balanceAfter: newAccountBalance,
          status: "SUCCESS",
          referenceType: "INTERNAL_TRANSFER",
          referenceId: refId,
          createdBy: userId,
          ipAddress,
          remark: `${remark} (wallet)`,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    /* ---------- engine sync (account side only) ---------- */
    try {
      const accId = String(account._id);
      publishAccountBalance(accId, newAccountBalance);
      await EngineSync.updateBalance(accId, newAccountBalance);
    } catch (error) {
      console.error(
        "[ENGINE_SYNC] wallet transfer sync failed",
        error && error.message ? error.message : error,
      );
    }

    return {
      success: true,
      referenceId: refId,
      direction,
      accountId: account._id,
      amount,
      walletBalance: newWalletBalance,
      walletAvailable: newAvailable,
      accountBalance: newAccountBalance,
    };
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      console.error(
        "[MONGO] abortTransaction failed (transferWalletService)",
        abortErr && abortErr.message ? abortErr.message : abortErr,
      );
    }
    session.endSession();
    throw err;
  }
}

/* =====================================================
   WALLET WITHDRAWAL REQUEST
===================================================== */

export async function requestWalletWithdrawalService({
  userId,
  amount,
  method,
  payout,
  ipAddress,
}) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 1) {
    throw publicError("Invalid amount");
  }
  if (!method || typeof method !== "string") {
    throw publicError("Method is required");
  }

  const payoutCheck = validatePayout({ method, payout });
  if (!payoutCheck.ok) throw publicError(payoutCheck.message);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await getUserOrThrow(userId, session);

    // KYC required (same rule as account withdrawals)
    const kycUser = await User.findById(userId)
      .select("kycStatus")
      .session(session);
    if (kycUser?.kycStatus !== "VERIFIED") {
      throw publicError("KYC not verified. Please complete KYC to withdraw");
    }

    // One pending wallet withdrawal at a time
    const pending = await Withdrawal.findOne({
      user: userId,
      source: "WALLET",
      status: { $in: ["PENDING", "APPROVED", "PROCESSING"] },
    }).session(session);
    if (pending) {
      throw publicError("You already have a pending withdrawal request");
    }

    const available = walletAvailable(user);
    if (amount > available) {
      throw publicError(
        `Only $${available.toFixed(2)} is available in your wallet`,
      );
    }

    // Enabled-method check (broker scoped)
    const brokerId = await getUserBrokerId(userId);
    if (brokerId) {
      const enabledCheck = await assertWithdrawMethodEnabled(brokerId, method);
      if (!enabledCheck.ok) throw publicError(enabledCheck.message);
    }

    // Lock funds: balance stays, hold increases
    const newHold = Number(user.wallet_hold_balance || 0) + amount;
    await User.updateOne(
      { _id: user._id },
      { $set: { wallet_hold_balance: newHold } },
      { session },
    );

    const withdrawalDocs = await Withdrawal.create(
      [
        {
          user: userId,
          account: null,
          source: "WALLET",
          amount,
          method,
          payout: buildPayoutSnapshot(payout),
          status: "PENDING",
          ipAddress: ipAddress || "",
          bonus_percent: 0,
          bonus_deducted: 0,
          ...(brokerId ? { brokerId } : {}),
        },
      ],
      { session },
    );

    const withdrawal = withdrawalDocs[0];

    await WalletTransaction.create(
      [
        {
          user: userId,
          type: "DEBIT",
          amount,
          balanceAfter: Math.max(
            0,
            Number(user.wallet_balance || 0) - newHold,
          ),
          status: "PENDING",
          referenceType: "WITHDRAWAL",
          referenceId: withdrawal._id,
          createdBy: userId,
          remark: "Wallet withdrawal request created (amount locked)",
          ipAddress: ipAddress || "",
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    return {
      success: true,
      message: "Wallet withdrawal request created successfully",
      data: withdrawal,
    };
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      console.error(
        "[MONGO] abortTransaction failed (requestWalletWithdrawalService)",
        abortErr && abortErr.message ? abortErr.message : abortErr,
      );
    }
    session.endSession();
    throw err;
  }
}

/* =====================================================
   USER: WALLET WITHDRAWAL HISTORY
===================================================== */

export async function listUserWalletWithdrawalsService({
  userId,
  page = 1,
  limit = 10,
}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const skip = (safePage - 1) * safeLimit;

  const filter = { user: userId, source: "WALLET" };

  const [items, total] = await Promise.all([
    Withdrawal.find(filter)
      .select("-payout.account_number")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Withdrawal.countDocuments(filter),
  ]);

  return {
    data: items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

/* =====================================================
   ADMIN: ADJUST WALLET BALANCE (credit / debit)
===================================================== */

export async function adminAdjustWalletService({
  adminId,
  userId,
  amount,
  direction,
  remark,
  ipAddress,
}) {
  if (!mongoose.isValidObjectId(userId)) throw publicError("Invalid userId");
  if (!["CREDIT", "DEBIT"].includes(direction)) {
    throw publicError("Invalid direction. Allowed: CREDIT, DEBIT");
  }
  validateTransferAmount(amount);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await getUserOrThrow(userId, session);

    const delta = direction === "CREDIT" ? amount : -amount;
    const newBalance = Number(user.wallet_balance || 0) + delta;

    if (newBalance < 0) {
      throw publicError(
        `Insufficient wallet balance. Available: $${walletAvailable(user).toFixed(2)}`,
      );
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { wallet_balance: newBalance } },
      { session },
    );

    const newAvailable = Math.max(
      0,
      newBalance - Number(user.wallet_hold_balance || 0),
    );

    await WalletTransaction.create(
      [
        {
          user: userId,
          type: direction,
          amount,
          balanceAfter: newAvailable,
          status: "SUCCESS",
          referenceType: "ADMIN_ADJUST",
          createdBy: adminId,
          remark: String(remark || "").trim() || "Admin wallet adjustment",
          ipAddress: ipAddress || "",
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    return {
      success: true,
      userId,
      direction,
      amount,
      walletBalance: newBalance,
      walletAvailable: newAvailable,
    };
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      console.error(
        "[MONGO] abortTransaction failed (adminAdjustWalletService)",
        abortErr && abortErr.message ? abortErr.message : abortErr,
      );
    }
    session.endSession();
    throw err;
  }
}
