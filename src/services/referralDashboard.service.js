import mongoose from "mongoose";
import Referral from "../models/Referral.model.js";
import ReferralReward from "../models/ReferralReward.model.js";
import Account from "../models/Account.model.js";
import Deposit from "../models/Deposit.model.js";
import Withdrawal from "../models/Withdrawal.model.js";
import Trade from "../models/Trade.model.js";
import { generateReferralCode } from "../utils/referralCode.util.js";
import { syncMissingReferralRewardsForReferrer } from "./referral.service.js";

async function ensureReferralProfile(userId) {
  return Referral.findOneAndUpdate(
    { user_id: userId },
    {
      $setOnInsert: {
        user_id: userId,
        referral_code: generateReferralCode(),
        referred_by: null,
        status: "CONFIRMED",
      },
    },
    { new: true, upsert: true },
  ).lean();
}

function periodRange(period, from, to) {
  const now = new Date();
  const end = new Date(now);
  let start = null;

  const p = String(period || "7d").toLowerCase();
  if (p === "today") {
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
  } else if (p === "7d") {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (p === "30d") {
    start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (p === "mtd") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (p === "custom" && from) {
    start = new Date(from);
    if (to) end.setTime(new Date(to).getTime());
  } else if (p === "all") {
    start = null;
  } else {
    start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }

  return { start, end };
}

function inRange(date, start, end) {
  if (!date) return false;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}

/** Collect user ids: direct only, or full downline (network/total). */
async function collectScopeUserIds(rootUserId, scope) {
  const root = String(rootUserId);
  const directDocs = await Referral.find({ referred_by: root })
    .select("user_id")
    .lean();
  const directIds = directDocs
    .map((d) => (d.user_id ? String(d.user_id) : null))
    .filter(Boolean);

  if (scope === "direct") {
    return { directIds, scopeIds: directIds };
  }

  // BFS network
  const seen = new Set(directIds);
  let frontier = [...directIds];
  while (frontier.length) {
    const batch = frontier.splice(0, frontier.length);
    const kids = await Referral.find({
      referred_by: { $in: batch.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select("user_id")
      .lean();
    const next = [];
    for (const k of kids) {
      const id = k.user_id ? String(k.user_id) : null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    frontier = next;
  }

  return { directIds, scopeIds: [...seen] };
}

/**
 * Full IB-style dashboard for portal referral page.
 */
export async function getReferralDashboardService({
  userId,
  scope = "total",
  period = "7d",
  from = null,
  to = null,
}) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  const safeScope = ["total", "network", "direct"].includes(String(scope))
    ? String(scope)
    : "total";
  const { start, end } = periodRange(period, from, to);
  const referral = await ensureReferralProfile(userId);
  try {
    await syncMissingReferralRewardsForReferrer(userId);
  } catch {
    /* non-fatal */
  }
  const { directIds, scopeIds } = await collectScopeUserIds(userId, safeScope);
  const objectIds = scopeIds.map((id) => new mongoose.Types.ObjectId(id));

  const emptyAgg = {
    totalClients: 0,
    newClients: 0,
    activeTraders: 0,
    subIbs: 0,
    directSubIbs: 0,
    totalDeposits: 0,
    netDeposits: 0,
    clientEquity: 0,
    totalLots: 0,
    tradeCount: 0,
    periodEarnings: 0,
    totalWithdrawals: 0,
    funnel: {
      linkClicks: 0,
      uniqueVisitors: 0,
      signedUp: 0,
      openedAccount: 0,
      fundedAccounts: 0,
    },
    commission: {
      totalEarned: Number(referral?.total_earned) || 0,
      paidOut: 0,
      pending: 0,
      available: Number(referral?.referral_balance) || 0,
    },
    recentDeposits: [],
    recentWithdrawals: [],
    recentPayouts: [],
    recentAccounts: [],
    activityTotals: {
      deposits: 0,
      withdrawals: 0,
      payouts: 0,
      accounts: 0,
    },
    referralCode: referral?.referral_code || null,
    linkUsedCount: directIds.length,
  };

  if (!objectIds.length) {
    return emptyAgg;
  }

  const [
    profiles,
    depositAgg,
    withdrawAgg,
    equityAgg,
    lotsAgg,
    periodEarnAgg,
    paidAgg,
    pendingAgg,
    requestedAgg,
    activeTraderAgg,
    recentDeposits,
    recentWithdrawals,
    recentPayouts,
    recentAccounts,
    accountOwners,
    fundedOwners,
  ] = await Promise.all([
    Referral.find({ user_id: { $in: objectIds } })
      .populate("user_id", "name email")
      .select("user_id total_referrals referred_by createdAt")
      .lean(),
    Deposit.aggregate([
      {
        $match: {
          user: { $in: objectIds },
          status: "APPROVED",
          ...(start ? { createdAt: { $gte: start, $lte: end } } : {}),
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Withdrawal.aggregate([
      {
        $match: {
          user: { $in: objectIds },
          status: { $in: ["APPROVED", "COMPLETED"] },
          ...(start ? { createdAt: { $gte: start, $lte: end } } : {}),
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    Account.aggregate([
      {
        $match: {
          user_id: { $in: objectIds },
          account_type: "live",
          status: "active",
        },
      },
      {
        $group: {
          _id: null,
          equity: {
            $sum: {
              $cond: [
                { $gt: ["$equity", 0] },
                "$equity",
                { $ifNull: ["$balance", 0] },
              ],
            },
          },
        },
      },
    ]),
    Trade.aggregate([
      {
        $match: {
          userId: { $in: objectIds },
          status: { $in: ["OPEN", "CLOSED", "CLOSING"] },
          ...(start ? { openTime: { $gte: start, $lte: end } } : {}),
        },
      },
      {
        $group: {
          _id: null,
          lots: { $sum: "$volume" },
          trades: { $sum: 1 },
        },
      },
    ]),
    ReferralReward.aggregate([
      {
        $match: {
          referrer_user: new mongoose.Types.ObjectId(userId),
          status: { $in: ["APPROVED", "ELIGIBLE", "REQUESTED"] },
          ...(start ? { createdAt: { $gte: start, $lte: end } } : {}),
        },
      },
      { $group: { _id: null, total: { $sum: "$reward_amount" } } },
    ]),
    ReferralReward.aggregate([
      {
        $match: {
          referrer_user: new mongoose.Types.ObjectId(userId),
          status: "APPROVED",
        },
      },
      { $group: { _id: null, total: { $sum: "$reward_amount" } } },
    ]),
    ReferralReward.aggregate([
      {
        $match: {
          referrer_user: new mongoose.Types.ObjectId(userId),
          status: "ELIGIBLE",
        },
      },
      { $group: { _id: null, total: { $sum: "$reward_amount" } } },
    ]),
    ReferralReward.aggregate([
      {
        $match: {
          referrer_user: new mongoose.Types.ObjectId(userId),
          status: "REQUESTED",
        },
      },
      { $group: { _id: null, total: { $sum: "$reward_amount" } } },
    ]),
    Trade.aggregate([
      {
        $match: {
          userId: { $in: objectIds },
          status: { $in: ["OPEN", "CLOSED", "CLOSING"] },
          ...(start ? { openTime: { $gte: start, $lte: end } } : {}),
        },
      },
      { $group: { _id: "$userId" } },
      { $count: "count" },
    ]),
    Deposit.find({
      user: { $in: objectIds },
      status: { $in: ["PENDING", "APPROVED"] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("user", "name email")
      .lean(),
    Withdrawal.find({
      user: { $in: objectIds },
      status: { $in: ["PENDING", "APPROVED", "COMPLETED", "PROCESSING"] },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("user", "name email")
      .lean(),
    ReferralReward.find({
      referrer_user: userId,
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("referred_user", "name email")
      .lean(),
    Account.find({
      user_id: { $in: objectIds },
      account_type: "live",
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("user_id", "name email")
      .select("account_number account_type status createdAt user_id")
      .lean(),
    Account.distinct("user_id", {
      user_id: { $in: objectIds },
      account_type: "live",
    }),
    Deposit.distinct("user", {
      user: { $in: objectIds },
      status: "APPROVED",
    }),
  ]);

  const newClients = profiles.filter((p) =>
    inRange(p.createdAt, start, end),
  ).length;
  const subIbs = profiles.filter(
    (p) => Number(p.total_referrals || 0) > 0,
  ).length;
  const directSubIbs = profiles.filter(
    (p) =>
      directIds.includes(String(p.user_id?._id || p.user_id)) &&
      Number(p.total_referrals || 0) > 0,
  ).length;

  const totalDeposits = Number(depositAgg[0]?.total || 0);
  const totalWithdrawals = Number(withdrawAgg[0]?.total || 0);

  const [depositsTotal, withdrawalsTotal, payoutsTotal, accountsTotal] =
    await Promise.all([
      Deposit.countDocuments({
        user: { $in: objectIds },
        status: { $in: ["PENDING", "APPROVED"] },
      }),
      Withdrawal.countDocuments({
        user: { $in: objectIds },
        status: { $in: ["PENDING", "APPROVED", "COMPLETED", "PROCESSING"] },
      }),
      ReferralReward.countDocuments({
        referrer_user: userId,
      }),
      Account.countDocuments({
        user_id: { $in: objectIds },
        account_type: "live",
      }),
    ]);

  return {
    referralCode: referral?.referral_code || null,
    linkUsedCount: directIds.length,
    scope: safeScope,
    period: String(period || "7d"),
    totalClients: scopeIds.length,
    newClients,
    activeTraders: Number(activeTraderAgg[0]?.count || 0),
    subIbs,
    directSubIbs,
    totalDeposits,
    netDeposits: totalDeposits - totalWithdrawals,
    clientEquity: Number(equityAgg[0]?.equity || 0),
    totalLots: Number(Number(lotsAgg[0]?.lots || 0).toFixed(2)),
    tradeCount: Number(lotsAgg[0]?.trades || 0),
    periodEarnings: Number(periodEarnAgg[0]?.total || 0),
    totalWithdrawals,
    funnel: {
      linkClicks: 0,
      uniqueVisitors: 0,
      signedUp: scopeIds.length,
      openedAccount: (accountOwners || []).length,
      fundedAccounts: (fundedOwners || []).length,
    },
    commission: {
      totalEarned: Number(referral?.total_earned) || 0,
      paidOut: Number(paidAgg[0]?.total || 0),
      // ELIGIBLE = ready to request; REQUESTED = waiting admin (included in pending)
      pending:
        Number(pendingAgg[0]?.total || 0) +
        Number(requestedAgg[0]?.total || 0),
      available: Number(pendingAgg[0]?.total || 0),
    },
    recentDeposits: (recentDeposits || []).map((d) => ({
      id: String(d._id),
      name: d.user?.name || "User",
      email: d.user?.email || "",
      amount: Number(d.amount || 0),
      status: d.status,
      createdAt: d.createdAt,
    })),
    recentWithdrawals: (recentWithdrawals || []).map((w) => ({
      id: String(w._id),
      name: w.user?.name || "User",
      email: w.user?.email || "",
      amount: Number(w.amount || 0),
      status: w.status,
      createdAt: w.createdAt,
    })),
    recentPayouts: (recentPayouts || []).map((r) => ({
      id: String(r._id),
      name: r.referred_user?.name || "Client",
      email: r.referred_user?.email || "",
      amount: Number(r.reward_amount || 0),
      status: r.status,
      createdAt: r.createdAt,
    })),
    recentAccounts: (recentAccounts || []).map((a) => ({
      id: String(a._id),
      name: a.user_id?.name || "User",
      email: a.user_id?.email || "",
      accountNumber: a.account_number,
      accountType: a.account_type,
      status: a.status,
      createdAt: a.createdAt,
    })),
    activityTotals: {
      deposits: Number(depositsTotal || 0),
      withdrawals: Number(withdrawalsTotal || 0),
      payouts: Number(payoutsTotal || 0),
      accounts: Number(accountsTotal || 0),
    },
  };
}
