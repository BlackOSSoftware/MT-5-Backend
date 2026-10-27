import mongoose from "mongoose";
import Account from "../models/Account.model.js";
import AccountPlan from "../models/AccountPlan.model.js";
import AccountAuth from "../models/AccountAuth.model.js";
import User from "../models/User.model.js";
import Trade from "../models/Trade.model.js";
import PendingOrder from "../models/PendingOrder.model.js";
import Brokerage from "../models/Brokerage.model.js";
import Transaction from "../models/Transaction.model.js";
import Deposit from "../models/Deposit.model.js";
import Withdrawal from "../models/Withdrawal.model.js";
import WatchlistItem from "../models/watchlistItem.model.js";
import ReferralReward from "../models/ReferralReward.model.js";

import EngineSync from "../trade-engine/EngineSync.js";
import {
  publishAccountSnapshot,
  publishAccountRemove,
} from "../trade-engine/EngineSyncBus.js";

import { sendAccountCreatedMail } from "../utils/mail.util.js";
import { generateAccountNumber } from "../utils/accountNumber.util.js";
import { generateStrongPassword } from "../utils/accountNumber.util.js";
import { hashPassword } from "../utils/hash.util.js";

const DEMO_DEFAULT_BALANCE = 10000;

/* =====================================================
   CREATE ACCOUNT
===================================================== */
export async function createAccount({
  userId,
  account_plan_id,
  account_type,
  opening_balance,
}) {
  if (!userId) throw new Error("User not authenticated");

  if (!["demo", "live"].includes(account_type)) {
    throw new Error("Invalid account type");
  }

  const openingBalanceProvided =
    opening_balance !== undefined && opening_balance !== null;
  const openingBalance = Number(opening_balance);

  if (openingBalanceProvided) {
    if (account_type !== "demo") {
      throw new Error("opening_balance is allowed only for demo accounts");
    }

    if (!Number.isFinite(openingBalance) || openingBalance <= 0) {
      throw new Error("Invalid opening_balance");
    }
  }

  /* ================= PLAN ================= */

  const plan = await AccountPlan.findOne({
    _id: account_plan_id,
    isActive: true,
  }).lean();

  if (!plan) throw new Error("Invalid plan");

  // Keep live/demo plans isolated:
  // - demo plan (is_demo_allowed=true) can create only demo accounts
  // - non-demo plan can create only live accounts
  if (account_type === "live" && plan.is_demo_allowed === true) {
    throw new Error("Live account not allowed on demo plan");
  }

  if (account_type === "demo" && plan.is_demo_allowed !== true) {
    throw new Error("Demo account not allowed on this plan");
  }

  /* ================= DEMO ================= */

  if (account_type === "demo") {
    const demoCount = await Account.countDocuments({
      user_id: userId,
      account_type: "demo",
    });

    if (demoCount >= 20 ) {
      throw new Error("Only 20 demo accounts allowed per user");
    }
  }

  /* ================= LIVE ================= */

  if (account_type === "live") {
    const liveCount = await Account.countDocuments({
      user_id: userId,
      account_type: "live",
    });

    if (liveCount >= 7) {
      throw new Error("Maximum 7 live accounts allowed");
    }
  }

  /* ================= CONFIG ================= */

  const leverage =
    typeof plan.max_leverage === "number" && plan.max_leverage > 0
      ? plan.max_leverage
      : 2000;

  if (leverage <= 0) throw new Error("Invalid leverage");

  const balance =
    account_type === "demo"
      ? openingBalanceProvided
        ? openingBalance
        : DEMO_DEFAULT_BALANCE
      : 0;

  const accountNumber = generateAccountNumber();

  /* ================= PASSWORD ================= */

  const tradePass = generateStrongPassword(12);
  let watchPass = generateStrongPassword(12);
  while (watchPass === tradePass) {
    watchPass = generateStrongPassword(12);
  }

  const tradeHash = await hashPassword(tradePass);
  const watchHash = await hashPassword(watchPass);

  /* ================= SNAPSHOT ================= */

  const commissionPerLot =
    typeof plan.commission_per_lot === "number"
      ? plan.commission_per_lot
      : 0;

  const swapEnabled =
    typeof plan.swap_enabled === "boolean"
      ? plan.swap_enabled
      : true;

  const swapCharge =
    typeof plan.swap_charge === "number"
      ? Math.abs(plan.swap_charge)
      : 0;

  /* ================= CREATE ================= */

  const owner = await User.findById(userId).select("brokerId").lean();
  const ownerBrokerId = owner?.brokerId || null;

  const account = await Account.create({
    user_id: userId,
    account_plan_id: plan._id,
    ...(ownerBrokerId ? { brokerId: ownerBrokerId } : {}),

    account_number: accountNumber,
    account_type,

    plan_name: plan.name,

    leverage,

    // ✅ SPREAD CONTROL (FROM PLAN)
    spread_enabled:
      typeof plan.spread_enabled === "boolean"
        ? plan.spread_enabled
        : true,

    spread_pips:
      typeof plan.spreadPips === "number"
        ? plan.spreadPips
        : 0,

    commission_per_lot: commissionPerLot,

    swap_enabled: swapEnabled,
    swap_charge: swapCharge,

    balance,
    equity: balance,

    currency: plan.currency || "USD",

    status: "active",
  });

  /* ================= AUTH ================= */

  await AccountAuth.create({
    account_id: account._id,
    account_number: account.account_number,

    trade_password_hash: tradeHash,
    watch_password_hash: watchHash,

    login_attempts: 0,
    is_locked: false,

    credentials_created_at: new Date(),
  });

  /* ================= ENGINE SYNC ================= */

  await EngineSync.onAccountCreated(account._id);
  publishAccountSnapshot(account);

  /* ================= MAIL ================= */

  const user = await User.findById(userId, { email: 1 }).lean();

  if (user?.email) {
    sendAccountCreatedMail({
      email: user.email,
      accountNumber: account.account_number,
      accountType: account.account_type,
      planName: account.plan_name,
      tradePassword: tradePass,
      watchPassword: watchPass,
    }).catch(() => {});
  }

  /* ================= RETURN ================= */

  return {
    id: account._id,

    account_number: account.account_number,
    account_type: account.account_type,
    plan_name: account.plan_name,

    balance: account.balance,
    currency: account.currency,
    leverage: account.leverage,

    spread_enabled: account.spread_enabled,

    commission_per_lot: account.commission_per_lot,

    swap_enabled: account.swap_enabled,
    swap_charge: account.swap_charge,

    trade_password: tradePass,
    watch_password: watchPass,
  };
}


/* =====================================================
   GET USER ACCOUNTS
===================================================== */
export async function getUserAccounts(userId) {
  if (!userId) throw new Error("User not authenticated");

  return Account.find(
    { user_id: userId },
    {
      account_number: 1,
      account_type: 1,
      plan_name: 1,
      leverage: 1,

      spread_enabled: 1,

      balance: 1,
      non_withdrawable_balance: 1,
      equity: 1,
      bonus_balance: 1,
      bonus_granted: 1,
      bonus_percent_override: 1,
      currency: 1,
      status: 1,

      createdAt: 1,
    },
  )
    .sort({ createdAt: -1 })
    .lean()
    .then((items) =>
      items.map((account) => ({
        ...account,
        total_balance:
          Number(account.balance || 0) + Number(account.bonus_balance || 0),
      }))
    );
}

/* =====================================================
   GET ACCOUNT DETAIL
===================================================== */
export async function getUserAccountDetail({ userId, accountId }) {
  if (!userId || !accountId) throw new Error("Invalid request");

  const account = await Account.findOne(
    { _id: accountId, user_id: userId },
    {
      account_number: 1,
      account_type: 1,
      plan_name: 1,

      leverage: 1,

      spread_enabled: 1,

      commission_per_lot: 1,

      swap_enabled: 1,

      balance: 1,
      non_withdrawable_balance: 1,
      equity: 1,
      bonus_balance: 1,
      bonus_granted: 1,
      bonus_percent_override: 1,
      currency: 1,

      status: 1,
      first_deposit: 1,

      createdAt: 1,
    },
  ).lean();

  if (!account) {
    const err = new Error("Account not found");
    err.statusCode = 404;
    throw err;
  }

  return {
    ...account,
    total_balance:
      Number(account.balance || 0) + Number(account.bonus_balance || 0),
  };
}

/* =====================================================
   RESET DEMO
===================================================== */
export async function resetDemoAccount({ userId, accountId }) {
  const account = await Account.findOne({
    _id: accountId,
    user_id: userId,
    account_type: "demo",
    status: "active",
  });

  if (!account) {
    const err = new Error("Demo account not found");
    err.statusCode = 400;
    throw err;
  }

  account.balance = DEMO_DEFAULT_BALANCE;
  account.equity = DEMO_DEFAULT_BALANCE + Number(account.bonus_balance || 0);

  await account.save();

  // ✅ ENGINE UPDATE
  await EngineSync.syncAccount(account._id);
  publishAccountSnapshot(account);

  return account;
}

/* =====================================================
   SET LEVERAGE
===================================================== */
export async function setAccountLeverage({ userId, accountId, leverage }) {
  if (!userId || !accountId) throw new Error("Invalid request");

  const account = await Account.findOne({
    _id: accountId,
    user_id: userId,
    status: "active",
  });

  if (!account) {
    const err = new Error("Account not found");
    err.statusCode = 404;
    throw err;
  }

  const plan = await AccountPlan.findById(account.account_plan_id).lean();

  if (!plan || !plan.isActive) {
    throw new Error("Plan not active");
  }

  if (plan.max_leverage > 0 && leverage > plan.max_leverage) {
    throw new Error(`Max leverage: ${plan.max_leverage}`);
  }

  if (leverage < 1) throw new Error("Invalid leverage");

  account.leverage = leverage;

  await account.save();

  // ✅ ENGINE UPDATE
  await EngineSync.syncAccount(account._id);
  publishAccountSnapshot(account);

  return {
    account_id: account._id,
    account_number: account.account_number,
    leverage: account.leverage,
  };
}

/* =====================================================
   ADMIN: LIST USER ACCOUNTS (FILTER + PAGINATION)
===================================================== */
export async function adminListUserAccounts({ userId, query = {}, brokerId = null }) {
  if (!userId || !mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  if (brokerId) {
    const { assertUserBelongsToBroker } = await import("../utils/brokerScope.js");
    await assertUserBelongsToBroker(userId, brokerId);
  }

  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 10;
  const skip = (page - 1) * limit;

  const filter = { user_id: new mongoose.Types.ObjectId(userId) };

  if (typeof query.account_type === "string" && query.account_type.trim()) {
    filter.account_type = query.account_type.trim().toLowerCase();
  }

  if (typeof query.status === "string" && query.status.trim()) {
    filter.status = query.status.trim().toLowerCase();
  }

  const [items, total] = await Promise.all([
    Account.find(filter)
      .select(
        "_id user_id account_plan_id account_number account_type plan_name leverage spread_enabled spread_pips commission_per_lot swap_enabled swap_charge balance hold_balance non_withdrawable_balance equity bonus_balance bonus_granted bonus_percent_override currency first_deposit status createdAt updatedAt"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Account.countDocuments(filter)
  ]);

  return {
    items: items.map((account) => ({
      ...account,
      total_balance:
        Number(account.balance || 0) + Number(account.bonus_balance || 0),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/* =====================================================
   ADMIN: SEARCH ACCOUNTS (USER NAME / EMAIL / PHONE / ACCOUNT NUMBER)
===================================================== */
export async function adminSearchAccounts({ query = {}, brokerId = null }) {
  const q = String(query.q || "").trim();

  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 10;
  const skip = (page - 1) * limit;

  const accountFilter = {};
  if (typeof query.account_type === "string" && query.account_type.trim()) {
    accountFilter.account_type = query.account_type.trim().toLowerCase();
  }
  if (typeof query.status === "string" && query.status.trim()) {
    accountFilter.status = query.status.trim().toLowerCase();
  }

  const pipeline = [
    { $match: accountFilter },
    {
      $lookup: {
        from: "users",
        localField: "user_id",
        foreignField: "_id",
        as: "user",
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
    ...(brokerId
      ? [
          {
            $match: {
              "user.brokerId": new mongoose.Types.ObjectId(String(brokerId)),
            },
          },
        ]
      : []),
    ...(q
      ? [
          {
            $match: {
              $or: [
                { account_number: { $regex: new RegExp(q, "i") } },
                { "user.name": { $regex: new RegExp(q, "i") } },
                { "user.email": { $regex: new RegExp(q, "i") } },
                { "user.phone": { $regex: new RegExp(q, "i") } },
              ],
            },
          },
        ]
      : []),
    { $sort: { createdAt: -1, _id: -1 } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              user_id: 1,
              account_plan_id: 1,
              account_number: 1,
              account_type: 1,
              plan_name: 1,
              leverage: 1,
              spread_enabled: 1,
              spread_pips: 1,
              commission_per_lot: 1,
              swap_enabled: 1,
              swap_charge: 1,
              balance: 1,
              hold_balance: 1,
              non_withdrawable_balance: 1,
              equity: 1,
              bonus_balance: 1,
              bonus_granted: 1,
              bonus_percent_override: 1,
              currency: 1,
              first_deposit: 1,
              status: 1,
              createdAt: 1,
              updatedAt: 1,
              user: {
                _id: "$user._id",
                name: "$user.name",
                email: "$user.email",
                phone: "$user.phone",
                userType: "$user.userType",
                isMailVerified: "$user.isMailVerified",
                kycStatus: "$user.kycStatus",
              },
            },
          },
        ],
        total: [{ $count: "count" }],
      },
    },
  ];

  const result = await Account.aggregate(pipeline).allowDiskUse(true);
  const items = result?.[0]?.items || [];
  const total = result?.[0]?.total?.[0]?.count || 0;

  return {
    items: items.map((account) => ({
      ...account,
      total_balance:
        Number(account.balance || 0) + Number(account.bonus_balance || 0),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/* =====================================================
   ADMIN: UPDATE ACCOUNT (FULL DETAILS)
===================================================== */
export async function adminUpdateAccountService({
  accountId,
  payload = {},
  brokerId = null,
}) {
  if (!accountId || !mongoose.isValidObjectId(accountId)) {
    throw new Error("Invalid accountId");
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("Request body is required");
  }

  const account = await Account.findById(accountId);
  if (!account) {
    throw new Error("Account not found");
  }

  if (brokerId) {
    const { assertUserBelongsToBroker } = await import("../utils/brokerScope.js");
    await assertUserBelongsToBroker(account.user_id, brokerId);
  }

  const plan = await AccountPlan.findById(account.account_plan_id).lean();

  const allowedFields = [
    "leverage",
    "spread_enabled",
    "spread_pips",
    "commission_per_lot",
    "swap_enabled",
    "swap_charge",
    "bonus_percent_override",
    "status",
  ];

  const updates = {};
  for (const key of allowedFields) {
    if (payload[key] !== undefined) {
      updates[key] = payload[key];
    }
  }

  if (updates.leverage !== undefined) {
    if (typeof updates.leverage !== "number" || updates.leverage < 1) {
      throw new Error("Invalid leverage");
    }

    if (plan && typeof plan.max_leverage === "number" && plan.max_leverage > 0) {
      if (updates.leverage > plan.max_leverage) {
        throw new Error(`Max leverage: ${plan.max_leverage}`);
      }
    }
  }

  if (updates.spread_pips !== undefined) {
    if (typeof updates.spread_pips !== "number" || updates.spread_pips < 0) {
      throw new Error("Invalid spread_pips");
    }
  }

  if (updates.commission_per_lot !== undefined) {
    if (
      typeof updates.commission_per_lot !== "number" ||
      updates.commission_per_lot < 0
    ) {
      throw new Error("Invalid commission_per_lot");
    }
  }

  if (updates.swap_charge !== undefined) {
    if (typeof updates.swap_charge !== "number" || updates.swap_charge < 0) {
      throw new Error("Invalid swap_charge");
    }
  }

  if (updates.bonus_percent_override !== undefined) {
    if (updates.bonus_percent_override === null) {
      updates.bonus_percent_override = null;
    } else if (
      typeof updates.bonus_percent_override !== "number" ||
      updates.bonus_percent_override < 0 ||
      updates.bonus_percent_override > 200
    ) {
      throw new Error("Invalid bonus_percent_override");
    }
  }

  if (updates.status !== undefined) {
    const status = String(updates.status).toLowerCase();
    if (!["active", "disabled"].includes(status)) {
      throw new Error("Invalid status");
    }
    updates.status = status;
  }

  if (updates.spread_enabled !== undefined) {
    updates.spread_enabled = Boolean(updates.spread_enabled);
  }

  if (updates.swap_enabled !== undefined) {
    updates.swap_enabled = Boolean(updates.swap_enabled);
  }


  Object.assign(account, updates);
  await account.save();

  await EngineSync.syncAccount(account._id);
  publishAccountSnapshot(account);

  return {
    ...account.toObject(),
    total_balance:
      Number(account.balance || 0) + Number(account.bonus_balance || 0),
  };
}

/* =====================================================
   ADMIN: DELETE ACCOUNT (CASCADE)
===================================================== */
export async function adminDeleteAccountService({
  accountId,
  userId,
  brokerId = null,
}) {
  if (!accountId || !mongoose.isValidObjectId(accountId)) {
    throw new Error("Invalid accountId");
  }

  const accountFilter = { _id: accountId };
  if (userId !== undefined) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new Error("Invalid userId");
    }
    accountFilter.user_id = userId;
  }

  const account = await Account.findOne(accountFilter)
    .select("_id user_id account_number account_type")
    .lean();

  if (!account) {
    throw new Error("Account not found");
  }

  if (brokerId) {
    const { assertUserBelongsToBroker } = await import("../utils/brokerScope.js");
    await assertUserBelongsToBroker(account.user_id, brokerId);
  }

  await Promise.all([
    AccountAuth.deleteOne({ account_id: account._id }),
    PendingOrder.deleteMany({ accountId: account._id }),
    Trade.deleteMany({ accountId: account._id }),
    Brokerage.deleteMany({ account_id: account._id }),
    Transaction.deleteMany({ account: account._id }),
    Deposit.deleteMany({ account: account._id }),
    Withdrawal.deleteMany({ account: account._id }),
    WatchlistItem.deleteMany({ accountId: account._id }),
    ReferralReward.deleteMany({
      $or: [{ referred_account: account._id }, { requested_account: account._id }],
    }),
    Account.deleteOne({ _id: account._id }),
  ]);

  EngineSync.removeAccount(String(account._id));
  publishAccountRemove(String(account._id));

  return {
    accountId: String(account._id),
    accountNumber: account.account_number,
    accountType: account.account_type,
    userId: String(account.user_id),
  };
}

