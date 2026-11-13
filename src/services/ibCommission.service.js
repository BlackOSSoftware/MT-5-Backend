import mongoose from "mongoose";
import Referral from "../models/Referral.model.js";
import Account from "../models/Account.model.js";
import IbCommission from "../models/IbCommission.model.js";
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
  for (const row of rows) {
    row.status = "REVERSED";
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

  return { reversed, clawbackPending: paidRows };
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
        },
      },
    ]),
  ]);

  const totals = { available: 0, paid: 0, pending: 0, reversed: 0, totalEarned: 0 };
  for (const row of agg) {
    const s = String(row._id || "").toUpperCase();
    const v = Number(row.sum) || 0;
    if (s === "AVAILABLE") totals.available = v;
    if (s === "PAID") totals.paid = v;
    if (s === "PENDING") totals.pending = v;
    if (s === "REVERSED") totals.reversed = v;
    if (s === "AVAILABLE" || s === "PAID" || s === "PENDING") {
      totals.totalEarned += v;
    }
  }

  return { items, total, page: Math.max(1, page), limit: take, totals };
}
