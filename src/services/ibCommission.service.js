import mongoose from "mongoose";
import Referral from "../models/Referral.model.js";
import Account from "../models/Account.model.js";
import IbCommission from "../models/IbCommission.model.js";
import Trade from "../models/Trade.model.js";
import User from "../models/User.model.js";
import Withdrawal from "../models/Withdrawal.model.js";
import WalletTransaction from "../models/WalletTransaction.model.js";
import { requestWalletWithdrawalService } from "./wallet.service.js";
import { getIbLevelSettings } from "./ibLevelSettings.service.js";
import {
  getPlanSymbolSpreadRow,
  resolveSpreadFromRow,
  isIbSpreadCommissionEnabled,
} from "./spreadResolver.service.js";

/**
 * Walk referred_by chain with cycle guard.
 * Returns [level1UserId, level2UserId, ...]
 */
export async function getUplineChain(traderUserId, maxDepth = 2) {
  const chain = [];
  const visited = new Set([String(traderUserId)]);
  let cursor = traderUserId;

  for (let i = 0; i < maxDepth; i++) {
    const ref = await Referral.findOne({ user_id: cursor })
      .select("referred_by")
      .lean();
    const parent = ref?.referred_by ? String(ref.referred_by) : null;
    if (!parent || visited.has(parent)) break;
    visited.add(parent);
    chain.push(parent);
    cursor = parent;
  }

  return chain;
}

/**
 * Credit IB commission on LIVE trade open/fill only.
 * Safe to call multiple times — unique index prevents duplicates.
 *
 * @param {object} params
 * @param {string} params.tradeId - stable trade/position id used for uniqueness
 * @param {string} params.positionId
 * @param {string} params.accountId
 * @param {string} params.symbol
 * @param {number} params.lots
 * @param {object} [params.instrument] - { spread, spread_mode, contractSize }
 */
export async function creditIbOnFill({
  tradeId,
  positionId = null,
  accountId,
  symbol,
  lots,
  instrument = null,
}) {
  if (!isIbSpreadCommissionEnabled()) {
    return { skipped: true, reason: "IB_SPREAD_COMMISSION_DISABLED" };
  }

  if (!tradeId || !accountId || !symbol) {
    return { skipped: true, reason: "MISSING_ARGS" };
  }

  const volume = Number(lots);
  if (!Number.isFinite(volume) || volume <= 0) {
    return { skipped: true, reason: "INVALID_LOTS" };
  }

  const account = await Account.findById(accountId)
    .select(
      "user_id account_type account_plan_id brokerId plan_name status",
    )
    .lean();

  if (!account) return { skipped: true, reason: "ACCOUNT_NOT_FOUND" };

  // P5: demo = no IB
  if (String(account.account_type).toLowerCase() !== "live") {
    return { skipped: true, reason: "DEMO_ACCOUNT" };
  }

  const planRow = await getPlanSymbolSpreadRow(
    account.account_plan_id,
    symbol,
  );

  const resolved = resolveSpreadFromRow({
    planRow,
    instrumentSpread: instrument?.spread,
    instrumentSpreadMode: instrument?.spread_mode,
    contractSize: instrument?.contractSize,
    planPricingEnabled: true, // read IB budget from plan row even if we only credit
  });

  // P3: missing plan row → IB=0
  if (!planRow || !(resolved.ibUsdPerLot > 0)) {
    return { skipped: true, reason: "NO_IB_BUDGET" };
  }

  const settings = await getIbLevelSettings(account.brokerId || null);
  const maxDepth = Number(settings.maxDepth) || settings.levels?.length || 2;
  const upline = await getUplineChain(account.user_id, maxDepth);

  if (!upline.length) {
    return { skipped: true, reason: "NO_REFERRER" };
  }

  const levelPercentMap = new Map(
    (settings.levels || []).map((l) => [Number(l.level), Number(l.percent)]),
  );

  const created = [];
  const traderUserId = account.user_id;

  for (let i = 0; i < upline.length; i++) {
    const level = i + 1;
    const percent = levelPercentMap.get(level);
    if (!percent || percent <= 0) continue;

    const ibUserId = upline[i];
    // P10 / self: never pay trader
    if (String(ibUserId) === String(traderUserId)) continue;

    const amount = Number(
      ((resolved.ibUsdPerLot * volume * percent) / 100).toFixed(8),
    );
    if (!(amount > 0)) continue;

    try {
      const row = await IbCommission.create({
        brokerId: account.brokerId || null,
        ib_user_id: ibUserId,
        trader_user_id: traderUserId,
        account_id: account._id,
        trade_id: String(tradeId),
        position_id: positionId ? String(positionId) : null,
        plan_id: account.account_plan_id || null,
        symbol: String(symbol).toUpperCase(),
        lots: volume,
        level,
        ib_usd_per_lot: resolved.ibUsdPerLot,
        house_usd_per_lot: resolved.houseUsdPerLot,
        client_spread: resolved.clientSpread,
        percent,
        amount,
        status: "AVAILABLE",
      });
      created.push(row);
    } catch (err) {
      // duplicate key → already credited
      if (err?.code === 11000) continue;
      console.error("[IB_COMMISSION] create failed:", err?.message || err);
    }
  }

  // Safety assert: total paid <= budget
  const paid = created.reduce((s, r) => s + Number(r.amount || 0), 0);
  const budget = resolved.ibUsdPerLot * volume;
  if (paid > budget + 0.0001) {
    console.error("[IB_COMMISSION] OVER_BUDGET", {
      tradeId,
      paid,
      budget,
    });
  }

  return {
    skipped: false,
    created: created.length,
    amounts: created.map((r) => ({
      ib_user_id: r.ib_user_id,
      level: r.level,
      amount: r.amount,
    })),
  };
}

/**
 * Reverse IB rows for a trade (admin edit / cancel).
 */
export async function reverseIbCommissionsForTrade(tradeId, reason = "") {
  const rows = await IbCommission.find({
    trade_id: String(tradeId),
    status: { $in: ["PENDING", "AVAILABLE"] },
  });

  let reversed = 0;
  let clawbackPartial = 0;
  for (const row of rows) {
    if (Number(row.paid_amount || 0) > 0) {
      row.status = "CLAWBACK_PENDING";
      clawbackPartial += 1;
    } else {
      row.status = "REVERSED";
    }
    await row.save();
    reversed += 1;
  }

  const paidRows = await IbCommission.countDocuments({
    trade_id: String(tradeId),
    status: "PAID",
  });
  if (paidRows > 0) {
    await IbCommission.updateMany(
      { trade_id: String(tradeId), status: "PAID" },
      { $set: { status: "CLAWBACK_PENDING" } },
    );
    console.warn("[IB_COMMISSION] CLAWBACK_PENDING", { tradeId, reason, paidRows });
  }

  return { reversed, clawbackPending: paidRows + clawbackPartial };
}

export async function listIbCommissionsAdmin({
  brokerId = null,
  ibUserId = null,
  page = 1,
  limit = 50,
} = {}) {
  const filter = {};
  if (brokerId) filter.brokerId = brokerId;
  if (ibUserId && mongoose.Types.ObjectId.isValid(ibUserId)) {
    filter.ib_user_id = ibUserId;
  }

  const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
  const take = Math.min(100, Math.max(1, limit));

  const [items, total] = await Promise.all([
    IbCommission.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(take)
      .populate("ib_user_id", "name email")
      .populate("trader_user_id", "name email")
      .populate("account_id", "account_number account_type plan_name")
      .populate("plan_id", "name")
      .lean(),
    IbCommission.countDocuments(filter),
  ]);

  return { items, total, page: Math.max(1, page), limit: take };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatDurationSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return null;
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

/**
 * IB-facing commission report: one row per credited commission joined with
 * the underlying trade (close time, profit, duration).
 */
export async function listIbCommissionReportForIb(
  ibUserId,
  { q, from, to, level, page = 1, limit = 50 } = {},
) {
  const filter = {
    ib_user_id: ibUserId,
    status: { $ne: "CANCELLED" },
  };

  const lvl = Number(level);
  if (Number.isFinite(lvl) && lvl >= 1) filter.level = lvl;

  const needle = String(q || "").trim();
  if (needle) {
    const rx = new RegExp(escapeRegex(needle), "i");
    const [users, accounts] = await Promise.all([
      User.find({
        $or: [{ name: rx }, { email: rx }],
      })
        .select("_id")
        .limit(200)
        .lean(),
      Account.find({ account_number: rx }).select("_id").limit(200).lean(),
    ]);
    filter.$or = [
      { trader_user_id: { $in: users.map((u) => u._id) } },
      { account_id: { $in: accounts.map((a) => a._id) } },
      { symbol: rx },
    ];
  }

  const docs = await IbCommission.find(filter)
    .sort({ createdAt: -1 })
    .limit(5000)
    .populate("trader_user_id", "name email")
    .populate("account_id", "account_number account_type plan_name")
    .lean();

  const tradeIds = [
    ...new Set(docs.map((d) => d.trade_id).filter(Boolean)),
  ];
  const trades = tradeIds.length
    ? await Trade.find({ positionId: { $in: tradeIds } })
        .select(
          "positionId ticket source realizedPnL grossPnL openTime closeTime volume status",
        )
        .lean()
    : [];
  const tradeMap = new Map(trades.map((t) => [String(t.positionId), t]));

  // Parent name = trader's direct referrer (upline level 1 sponsor).
  const traderIds = [
    ...new Set(docs.map((d) => d.trader_user_id?._id || d.trader_user_id).filter(Boolean)),
  ];
  const referrals = traderIds.length
    ? await Referral.find({ user_id: { $in: traderIds } })
        .select("user_id referred_by")
        .lean()
    : [];
  const parentIds = [
    ...new Set(referrals.map((r) => String(r.referred_by)).filter(Boolean)),
  ];
  const parentUsers = parentIds.length
    ? await User.find({ _id: { $in: parentIds } })
        .select("name")
        .lean()
    : [];
  const parentNameMap = new Map(parentUsers.map((u) => [String(u._id), u.name]));
  const traderParentMap = new Map(
    referrals.map((r) => [
      String(r.user_id),
      parentNameMap.get(String(r.referred_by)) || "—",
    ]),
  );

  let items = docs.map((d) => {
    const t = tradeMap.get(String(d.trade_id)) || null;
    const openTime = t?.openTime || d.createdAt || null;
    const closeTime = t?.closeTime || null;
    const durationSec =
      openTime && closeTime
        ? Math.max(
            0,
            (new Date(closeTime).getTime() - new Date(openTime).getTime()) /
              1000,
          )
        : null;
    const acct = d.account_id || null;
    return {
      id: String(d._id),
      positionId: d.position_id || d.trade_id || null,
      ticket: t?.ticket ?? null,
      tradeId: d.trade_id,
      clientName: d.trader_user_id?.name || "—",
      clientEmail: d.trader_user_id?.email || "",
      parentName:
        traderParentMap.get(String(d.trader_user_id?._id || d.trader_user_id)) ||
        "—",
      level: d.level,
      accountType: acct?.plan_name || acct?.account_type || "—",
      accountTypeRaw: acct?.account_type || "",
      accountNumber: acct?.account_number || "",
      source: t?.source || null,
      symbol: d.symbol,
      lots: d.lots,
      commission: Number(d.amount) || 0,
      profit: t
        ? Number(t.realizedPnL ?? t.grossPnL ?? 0) || 0
        : null,
      tradeStatus: t?.status || (closeTime ? "CLOSED" : "OPEN"),
      openTime,
      closeTime,
      durationSec,
      duration: formatDurationSeconds(durationSec),
      percent: d.percent,
      ibUsdPerLot: d.ib_usd_per_lot,
      status: d.status,
      createdAt: d.createdAt,
    };
  });

  // Date filter applies to close time (fallback: commission credit time).
  const fromD = from ? new Date(from) : null;
  const toD = to ? new Date(to) : null;
  const validFrom = fromD && !Number.isNaN(fromD.getTime()) ? fromD : null;
  const validTo =
    toD && !Number.isNaN(toD.getTime())
      ? new Date(toD.getTime() + 24 * 60 * 60 * 1000 - 1)
      : null;
  if (validFrom || validTo) {
    items = items.filter((i) => {
      const d = i.closeTime || i.createdAt;
      if (!d) return false;
      const t = new Date(d).getTime();
      if (validFrom && t < validFrom.getTime()) return false;
      if (validTo && t > validTo.getTime()) return false;
      return true;
    });
  }

  items.sort((a, b) => {
    const da = new Date(a.closeTime || a.createdAt || 0).getTime();
    const db = new Date(b.closeTime || b.createdAt || 0).getTime();
    return db - da;
  });

  const totals = { commission: 0, profit: 0, count: items.length };
  for (const i of items) {
    totals.commission += Number(i.commission) || 0;
    if (i.profit != null) totals.profit += Number(i.profit) || 0;
  }

  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const skip = (safePage - 1) * safeLimit;
  const paged = items.slice(skip, skip + safeLimit);

  return {
    items: paged,
    totals,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: items.length,
      totalPages: items.length === 0 ? 0 : Math.ceil(items.length / safeLimit),
    },
  };
}

/**
 * Wallet-style summary of a single IB user's commission ledger.
 */
export async function getIbCommissionSummaryForIb(ibUserId) {
  const uid = mongoose.Types.ObjectId.isValid(ibUserId)
    ? new mongoose.Types.ObjectId(ibUserId)
    : ibUserId;

  const rows = await IbCommission.aggregate([
    {
      $match: {
        ib_user_id: uid,
        status: { $nin: ["REVERSED", "CANCELLED"] },
      },
    },
    {
      $group: {
        _id: "$status",
        total: { $sum: "$amount" },
        paid: { $sum: "$paid_amount" },
        count: { $sum: 1 },
      },
    },
  ]);

  const byStatus = new Map(rows.map((r) => [r._id, r]));
  const sum = (s) => Number(byStatus.get(s)?.total || 0);
  const sumPaid = (s) => Number(byStatus.get(s)?.paid || 0);
  const count = (s) => Number(byStatus.get(s)?.count || 0);

  const availGross = sum("AVAILABLE");
  const availPaid = sumPaid("AVAILABLE");
  const available = Math.max(0, availGross - availPaid);
  const pending = sum("PENDING");
  const paidOut = sum("PAID") + availPaid;
  const clawback = sum("CLAWBACK_PENDING");
  const totalEarned = available + pending + paidOut + clawback;

  return {
    totalEarned: Number(totalEarned.toFixed(8)),
    available: Number(available.toFixed(8)),
    pending: Number(pending.toFixed(8)),
    paidOut: Number(paidOut.toFixed(8)),
    clawbackPending: Number(clawback.toFixed(8)),
    counts: {
      available: count("AVAILABLE"),
      pending: count("PENDING"),
      paid: count("PAID"),
      total: rows.reduce((s, r) => s + r.count, 0),
    },
  };
}

function ibPublicError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.isPublic = true;
  return err;
}

/**
 * Convert AVAILABLE IB commission -> wallet (partial amounts supported via
 * `paid_amount`), then create a normal wallet withdrawal request for `amount`.
 * FIFO across rows; wallet is credited exactly `amount`.
 */
export async function withdrawIbCommissionService({
  userId,
  amount,
  method,
  payout,
  ipAddress,
}) {
  if (!Number.isFinite(amount) || amount < 1) {
    throw ibPublicError("Invalid amount");
  }

  const user = await User.findById(userId)
    .select("kycStatus wallet_balance wallet_hold_balance")
    .lean();
  if (!user) throw ibPublicError("User not found", 404);
  if (user.kycStatus !== "VERIFIED") {
    throw ibPublicError("KYC not verified. Please complete KYC to withdraw");
  }

  const pending = await Withdrawal.findOne({
    user: userId,
    source: "WALLET",
    status: { $in: ["PENDING", "APPROVED", "PROCESSING"] },
  }).lean();
  if (pending) {
    throw ibPublicError("You already have a pending withdrawal request");
  }

  const rows = await IbCommission.find({
    ib_user_id: userId,
    status: "AVAILABLE",
  })
    .sort({ createdAt: 1 })
    .lean();

  const rowRemaining = (r) =>
    Math.max(0, Number(r.amount || 0) - Number(r.paid_amount || 0));
  const available = rows.reduce((s, r) => s + rowRemaining(r), 0);
  if (amount > available + 1e-9) {
    throw ibPublicError(
      `Only $${available.toFixed(2)} commission is available to withdraw`,
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  let converted = 0;
  let markedCount = 0;
  try {
    let remaining = amount;
    for (const row of rows) {
      if (remaining <= 1e-9) break;
      const rem = rowRemaining(row);
      if (rem <= 1e-9) continue;
      const pay = Math.min(rem, remaining);
      const newPaid = Number(row.paid_amount || 0) + pay;
      const fullyPaid = newPaid >= Number(row.amount || 0) - 1e-9;
      await IbCommission.updateOne(
        { _id: row._id, status: "AVAILABLE" },
        {
          $set: {
            paid_amount: Number(newPaid.toFixed(8)),
            status: fullyPaid ? "PAID" : "AVAILABLE",
          },
        },
        { session },
      );
      converted += pay;
      markedCount += 1;
      remaining -= pay;
    }

    const fresh = await User.findById(userId)
      .select("wallet_balance wallet_hold_balance")
      .session(session);
    const newBalance = Number(fresh.wallet_balance || 0) + converted;
    await User.updateOne(
      { _id: userId },
      { $set: { wallet_balance: newBalance } },
      { session },
    );

    await WalletTransaction.create(
      [
        {
          user: userId,
          type: "CREDIT",
          amount: converted,
          balanceAfter: Math.max(
            0,
            newBalance - Number(fresh.wallet_hold_balance || 0),
          ),
          status: "SUCCESS",
          referenceType: "SYSTEM",
          createdBy: userId,
          remark: `IB commission converted to wallet (${markedCount} entries)`,
          ipAddress: ipAddress || "",
        },
      ],
      { session },
    );

    await session.commitTransaction();
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch (abortErr) {
      console.error(
        "[MONGO] abortTransaction failed (withdrawIbCommissionService)",
        abortErr && abortErr.message ? abortErr.message : abortErr,
      );
    }
    session.endSession();
    throw err;
  }
  session.endSession();

  const result = await requestWalletWithdrawalService({
    userId,
    amount,
    method,
    payout,
    ipAddress,
  });

  return {
    ...result,
    data: {
      ...(result.data && typeof result.data.toObject === "function"
        ? result.data.toObject()
        : result.data || {}),
      commissionConverted: Number(converted.toFixed(8)),
    },
  };
}

export async function listIbCommissionsForIbUser(ibUserId, { page = 1, limit = 50 } = {}) {
  const filter = { ib_user_id: ibUserId, status: { $ne: "CANCELLED" } };
  const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
  const take = Math.min(100, Math.max(1, limit));

  const [items, total, agg] = await Promise.all([
    IbCommission.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(take)
      .populate("trader_user_id", "name email")
      .populate("account_id", "account_number plan_name account_type")
      .lean(),
    IbCommission.countDocuments(filter),
    IbCommission.aggregate([
      { $match: { ib_user_id: new mongoose.Types.ObjectId(String(ibUserId)) } },
      {
        $group: {
          _id: "$status",
          sum: { $sum: "$amount" },
          paid: { $sum: "$paid_amount" },
        },
      },
    ]),
  ]);

  const totals = { available: 0, paid: 0, pending: 0, reversed: 0, totalEarned: 0 };
  for (const row of agg) {
    const s = String(row._id || "").toUpperCase();
    const v = Number(row.sum) || 0;
    const pv = Number(row.paid) || 0;
    if (s === "AVAILABLE") {
      totals.available = Math.max(0, v - pv);
      totals.paid += pv;
    }
    if (s === "PAID") totals.paid += v;
    if (s === "PENDING") totals.pending = v;
    if (s === "REVERSED") totals.reversed = v;
    if (s === "AVAILABLE" || s === "PAID" || s === "PENDING") {
      totals.totalEarned += v;
    }
  }

  return { items, total, page: Math.max(1, page), limit: take, totals };
}
