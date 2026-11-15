import mongoose from "mongoose";

import Account from "../models/Account.model.js";
import AccountPlan from "../models/AccountPlan.model.js";
import Transaction from "../models/Transaction.model.js";
import Trade from "../models/Trade.model.js";

import EngineSync from "../trade-engine/EngineSync.js";
import { publishAccountBalance } from "../trade-engine/EngineSyncBus.js";
import { getWithdrawableBalance } from "../utils/nonWithdrawable.util.js";
import {
  ACTIVITY_ACTIONS,
  ACTOR_TYPES,
  recordActivity,
} from "./activity.service.js";

/* =====================================================
   HELPERS
===================================================== */

function isValidAmount(amount) {
  if (typeof amount !== "number") return false;
  if (!Number.isFinite(amount)) return false;
  return true;
}

function hasMaxTwoDecimals(amount) {
  return Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-9;
}

function getStartOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getEndOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

function publicError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isPublic = true;
  return err;
}

/* =====================================================
   RATE LIMIT HELPERS
===================================================== */

async function enforceCooldown({ userId, session, cooldownSeconds }) {
  const last = await Transaction.findOne(
    {
      user: userId,
      referenceType: "INTERNAL_TRANSFER",
      status: "SUCCESS",
    },
    { createdAt: 1 }
  )
    .sort({ createdAt: -1 })
    .session(session)
    .lean();

  if (!last) return;

  const diff = Math.floor(
    (Date.now() - new Date(last.createdAt).getTime()) / 1000
  );

  if (diff < cooldownSeconds) {
    throw publicError(
      `Please wait ${cooldownSeconds - diff}s before next transfer`,
    );
  }
}

async function enforceDailyLimits({
  userId,
  amount,
  session,
  maxTransfersPerDay,
  maxDailyAmount,
}) {
  const start = getStartOfDay(new Date());
  const end = getEndOfDay(new Date());

  const count = await Transaction.countDocuments({
    user: userId,
    type: "INTERNAL_TRANSFER_OUT",
    referenceType: "INTERNAL_TRANSFER",
    status: "SUCCESS",
    createdAt: { $gte: start, $lte: end },
  }).session(session);

  if (count >= maxTransfersPerDay) {
    throw publicError(`Daily transfer limit reached (${maxTransfersPerDay})`);
  }

  const agg = await Transaction.aggregate([
    {
      $match: {
        user: new mongoose.Types.ObjectId(String(userId)),
        type: "INTERNAL_TRANSFER_OUT",
        referenceType: "INTERNAL_TRANSFER",
        status: "SUCCESS",
        createdAt: { $gte: start, $lte: end },
      },
    },
    {
      $group: { _id: null, total: { $sum: "$amount" } },
    },
  ]).session(session);

  const today = agg.length ? agg[0].total : 0;

  if (today + amount > maxDailyAmount) {
    throw publicError(`Daily amount limit exceeded ($${maxDailyAmount})`);
  }
}

/* =====================================================
   MAIN SERVICE
===================================================== */

export async function createInternalTransferService({
  userId,
  fromAccount,
  toAccount,
  amount,
  ipAddress,
}) {
  /* ================= BASIC VALIDATION ================= */

  if (!fromAccount || !toAccount || amount === undefined || amount === null) {
    throw publicError("All fields are required");
  }

  if (
    !mongoose.isValidObjectId(fromAccount) ||
    !mongoose.isValidObjectId(toAccount)
  ) {
    throw publicError("Invalid account id");
  }

  if (String(fromAccount) === String(toAccount)) {
    throw publicError("From and To accounts must be different");
  }

  if (!isValidAmount(amount)) {
    throw publicError("Invalid transfer amount");
  }

  if (amount <= 0) {
    throw publicError("Amount must be greater than 0");
  }

  if (!hasMaxTwoDecimals(amount)) {
    throw publicError("Max 2 decimal places allowed");
  }

  const MIN = 10;
  const MAX = 50000;

  if (amount < MIN) throw publicError(`Minimum $${MIN}`);
  if (amount > MAX) throw publicError(`Maximum $${MAX}`);

  /* ================= TRANSACTION ================= */

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    /* ================= RATE LIMIT ================= */

    await enforceCooldown({
      userId,
      session,
      cooldownSeconds: 10,
    });

    await enforceDailyLimits({
      userId,
      amount,
      session,
      maxTransfersPerDay: 10,
      maxDailyAmount: 100000,
    });

    /* ================= ACCOUNT VALIDATION ================= */

    const fromAcc = await Account.findOne({
      _id: fromAccount,
      user_id: userId,
      status: "active",
    }).session(session);

    const toAcc = await Account.findOne({
      _id: toAccount,
      user_id: userId,
      status: "active",
    }).session(session);

    if (!fromAcc) throw publicError("From account invalid");
    if (!toAcc) throw publicError("To account invalid");

    /* ================= LIVE → LIVE ================= */

    if (fromAcc.account_type !== "live") {
      throw publicError("Only LIVE accounts allowed");
    }

    if (toAcc.account_type !== "live") {
      throw publicError("Only LIVE accounts allowed");
    }

    /* ================= OPEN TRADE BLOCK ================= */

    const openTrades = await Trade.countDocuments({
      accountId: fromAcc._id,
      status: "OPEN",
    }).session(session);

    if (openTrades > 0) {
      throw publicError("Transfer blocked: Close all open trades first");
    }

    /* ================= FIRST DEPOSIT ================= */

    if (toAcc.first_deposit === false) {
      const plan = await AccountPlan.findById(toAcc.account_plan_id)
        .session(session)
        .lean();

      throw publicError(`Complete first deposit of $${plan?.minDeposit || 0}`);
    }

    /* ================= BALANCE CHECK ================= */

    const withdrawableBalance = getWithdrawableBalance(fromAcc);

    if (amount > withdrawableBalance) {
      throw publicError(
        `Only $${withdrawableBalance.toFixed(2)} is transferable from this account`,
      );
    }

    /* ================= UPDATE BALANCES ================= */

    const fromNew = fromAcc.balance - amount;
    const toNew = toAcc.balance + amount;

    await Account.updateOne(
      { _id: fromAcc._id },
      // Keep DB equity in sync with balance + bonus for non-trade operations.
      // (Floating PnL is tracked in the trade-engine RAM, not persisted here.)
      {
        $set: {
          balance: fromNew,
          equity: Number(fromNew) + Number(fromAcc.bonus_balance || 0),
        },
      },
      { session },
    );

    await Account.updateOne(
      { _id: toAcc._id },
      {
        $set: {
          balance: toNew,
          equity: Number(toNew) + Number(toAcc.bonus_balance || 0),
        },
      },
      { session },
    );

    /* ================= TRANSACTION HISTORY ================= */

    const refId = new mongoose.Types.ObjectId();

    await Transaction.create(
      [
        {
          user: userId,
          account: fromAcc._id,
          type: "INTERNAL_TRANSFER_OUT",
          amount,
          balanceAfter: fromNew,
          status: "SUCCESS",
          referenceType: "INTERNAL_TRANSFER",
          referenceId: refId,
          createdBy: userId,
          ipAddress,
          remark: "Internal transfer debit",
        },

        {
          user: userId,
          account: toAcc._id,
          type: "INTERNAL_TRANSFER_IN",
          amount,
          balanceAfter: toNew,
          status: "SUCCESS",
          referenceType: "INTERNAL_TRANSFER",
          referenceId: refId,
          createdBy: userId,
          ipAddress,
          remark: "Internal transfer credit",
        },
      ],
      { session, ordered: true }
    );

    /* ================= COMMIT ================= */

    await session.commitTransaction();
    session.endSession();

    /* ================= ENGINE SYNC ================= */

    try {
      const fromId = String(fromAcc._id);
      const toId = String(toAcc._id);

      publishAccountBalance(fromId, fromNew);
      publishAccountBalance(toId, toNew);

      await EngineSync.updateBalance(fromId, fromNew);
      await EngineSync.updateBalance(toId, toNew);
    } catch (error) {
      console.error(
        "[ENGINE_SYNC] onInternalTransfer failed (createInternalTransferService)",
        error && error.message ? error.message : error
      );
    }

    recordActivity({
      userId,
      action: ACTIVITY_ACTIONS.TRANSFER_COMPLETED,
      actorId: userId,
      actorType: ACTOR_TYPES.SELF,
      ip: ipAddress || null,
    }).catch((err) => console.error("ACTIVITY_LOG_ERROR:", err));

    return {
      success: true,
      referenceId: refId,
      fromAccount: fromAcc._id,
      toAccount: toAcc._id,
      amount,
      fromBalance: fromNew,
      toBalance: toNew,
    };
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      console.error(
        "[MONGO] abortTransaction failed (createInternalTransferService)",
        abortErr && abortErr.message ? abortErr.message : abortErr
      );
    }
    session.endSession();
    throw err;
  }
}

/* =====================================================
   ADMIN: TRANSFER ON BEHALF (SAME USER)
===================================================== */

export async function adminCreateInternalTransferService({
  adminId,
  fromAccount,
  toAccount,
  amount,
  ipAddress,
}) {
  if (!adminId || !mongoose.isValidObjectId(adminId)) {
    throw publicError("Invalid adminId");
  }

  if (!fromAccount || !toAccount || amount === undefined || amount === null) {
    throw publicError("All fields are required");
  }

  if (
    !mongoose.isValidObjectId(fromAccount) ||
    !mongoose.isValidObjectId(toAccount)
  ) {
    throw publicError("Invalid account id");
  }

  if (String(fromAccount) === String(toAccount)) {
    throw publicError("From and To accounts must be different");
  }

  if (!isValidAmount(amount)) {
    throw publicError("Invalid transfer amount");
  }

  if (amount <= 0) {
    throw publicError("Amount must be greater than 0");
  }

  if (!hasMaxTwoDecimals(amount)) {
    throw publicError("Max 2 decimal places allowed");
  }

  const MIN = 10;
  const MAX = 50000;

  if (amount < MIN) throw publicError(`Minimum $${MIN}`);
  if (amount > MAX) throw publicError(`Maximum $${MAX}`);

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const fromAcc = await Account.findOne({
      _id: fromAccount,
      status: "active",
    }).session(session);

    const toAcc = await Account.findOne({
      _id: toAccount,
      status: "active",
    }).session(session);

    if (!fromAcc) throw publicError("From account invalid");
    if (!toAcc) throw publicError("To account invalid");

    const userId = String(fromAcc.user_id);

    if (String(toAcc.user_id) !== userId) {
      throw publicError("Transfer allowed only within same user accounts");
    }

    await enforceCooldown({
      userId,
      session,
      cooldownSeconds: 10,
    });

    await enforceDailyLimits({
      userId,
      amount,
      session,
      maxTransfersPerDay: 10,
      maxDailyAmount: 100000,
    });

    if (fromAcc.account_type !== "live") {
      throw publicError("Only LIVE accounts allowed");
    }

    if (toAcc.account_type !== "live") {
      throw publicError("Only LIVE accounts allowed");
    }

    const openTrades = await Trade.countDocuments({
      accountId: fromAcc._id,
      status: "OPEN",
    }).session(session);

    if (openTrades > 0) {
      throw publicError("Transfer blocked: Close all open trades first");
    }

    if (toAcc.first_deposit === false) {
      const plan = await AccountPlan.findById(toAcc.account_plan_id)
        .session(session)
        .lean();

      throw publicError(`Complete first deposit of $${plan?.minDeposit || 0}`);
    }

    const withdrawableBalance = getWithdrawableBalance(fromAcc);

    if (amount > withdrawableBalance) {
      throw publicError(
        `Only $${withdrawableBalance.toFixed(2)} is transferable from this account`,
      );
    }

    const fromNew = fromAcc.balance - amount;
    const toNew = toAcc.balance + amount;

    await Account.updateOne(
      { _id: fromAcc._id },
      // Keep DB equity in sync with balance + bonus for non-trade operations.
      // (Floating PnL is tracked in the trade-engine RAM, not persisted here.)
      {
        $set: {
          balance: fromNew,
          equity: Number(fromNew) + Number(fromAcc.bonus_balance || 0),
        },
      },
      { session },
    );

    await Account.updateOne(
      { _id: toAcc._id },
      {
        $set: {
          balance: toNew,
          equity: Number(toNew) + Number(toAcc.bonus_balance || 0),
        },
      },
      { session },
    );

    const refId = new mongoose.Types.ObjectId();

    await Transaction.create(
      [
        {
          user: userId,
          account: fromAcc._id,
          type: "INTERNAL_TRANSFER_OUT",
          amount,
          balanceAfter: fromNew,
          status: "SUCCESS",
          referenceType: "INTERNAL_TRANSFER",
          referenceId: refId,
          createdBy: adminId,
          ipAddress,
          remark: "Admin internal transfer debit",
        },
        {
          user: userId,
          account: toAcc._id,
          type: "INTERNAL_TRANSFER_IN",
          amount,
          balanceAfter: toNew,
          status: "SUCCESS",
          referenceType: "INTERNAL_TRANSFER",
          referenceId: refId,
          createdBy: adminId,
          ipAddress,
          remark: "Admin internal transfer credit",
        },
      ],
      { session, ordered: true },
    );

    await session.commitTransaction();
    session.endSession();

    try {
      const fromId = String(fromAcc._id);
      const toId = String(toAcc._id);

      publishAccountBalance(fromId, fromNew);
      publishAccountBalance(toId, toNew);

      await EngineSync.updateBalance(fromId, fromNew);
      await EngineSync.updateBalance(toId, toNew);
    } catch (error) {
      console.error(
        "[ENGINE_SYNC] onInternalTransfer failed (adminCreateInternalTransferService)",
        error && error.message ? error.message : error
      );
    }

    recordActivity({
      userId,
      action: ACTIVITY_ACTIONS.TRANSFER_COMPLETED,
      actorId: adminId,
      actorType: ACTOR_TYPES.ADMIN,
      ip: ipAddress || null,
    }).catch((err) => console.error("ACTIVITY_LOG_ERROR:", err));

    return {
      success: true,
      referenceId: refId,
      userId,
      fromAccount: fromAcc._id,
      toAccount: toAcc._id,
      amount,
      fromBalance: fromNew,
      toBalance: toNew,
    };
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      console.error(
        "[MONGO] abortTransaction failed (adminCreateInternalTransferService)",
        abortErr && abortErr.message ? abortErr.message : abortErr
      );
    }
    session.endSession();
    throw err;
  }
}

/* =====================================================
   HISTORY
===================================================== */

export async function getUserInternalTransfersService({
  userId,
  page = 1,
  limit = 10,
}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

  const skip = (safePage - 1) * safeLimit;

  const filter = {
    user: userId,
    referenceType: "INTERNAL_TRANSFER",
    status: "SUCCESS",
    type: {
      $in: ["INTERNAL_TRANSFER_OUT", "INTERNAL_TRANSFER_IN"],
    },
  };

  const [data, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("account", "account_number account_type status")
      .lean(),

    Transaction.countDocuments(filter),
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
