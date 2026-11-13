import mongoose from "mongoose";
import Referral from "../models/Referral.model.js";
import ReferralReward from "../models/ReferralReward.model.js";
import Account from "../models/Account.model.js";
import Deposit from "../models/Deposit.model.js";
import Withdrawal from "../models/Withdrawal.model.js";
import Trade from "../models/Trade.model.js";
import User from "../models/User.model.js";
import IbRequest from "../models/IbRequest.model.js";
import Kyc from "../models/Kyc.model.js";
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
    kycStats: { pending: 0, complete: 0 },
    liveAccountStats: { pending: 0, complete: 0, total: 0 },
    ibRequestStats: { pending: 0, approved: 0, rejected: 0 },
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
    kycAgg,
    liveAccountAgg,
    ibRequestAgg,
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
    User.aggregate([
      { $match: { _id: { $in: objectIds } } },
      { $group: { _id: "$kycStatus", count: { $sum: 1 } } },
    ]),
    Account.aggregate([
      {
        $match: {
          user_id: { $in: objectIds },
          account_type: "live",
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    IbRequest.aggregate([
      { $match: { ib: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
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

  const KYC_COMPLETE = new Set(["VERIFIED", "APPROVED", "COMPLETED"]);
  const KYC_PENDING = new Set([
    "PENDING",
    "SUBMITTED",
    "IN_REVIEW",
    "UNDER_REVIEW",
    "PROCESSING",
  ]);
  let kycPending = 0;
  let kycComplete = 0;
  for (const row of kycAgg || []) {
    const status = String(row._id || "").toUpperCase();
    if (KYC_COMPLETE.has(status)) kycComplete += Number(row.count || 0);
    else if (KYC_PENDING.has(status)) kycPending += Number(row.count || 0);
  }

  let livePending = 0;
  let liveComplete = 0;
  for (const row of liveAccountAgg || []) {
    const status = String(row._id || "").toLowerCase();
    const count = Number(row.count || 0);
    if (status === "active") liveComplete += count;
    else livePending += count;
  }
  const liveTotal = livePending + liveComplete;

  const ibRequestStats = { pending: 0, approved: 0, rejected: 0 };
  for (const row of ibRequestAgg || []) {
    const status = String(row._id || "").toUpperCase();
    const count = Number(row.count || 0);
    if (status === "PENDING") ibRequestStats.pending = count;
    else if (status === "APPROVED") ibRequestStats.approved = count;
    else if (status === "REJECTED") ibRequestStats.rejected = count;
  }

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
    kycStats: { pending: kycPending, complete: kycComplete },
    liveAccountStats: {
      pending: livePending,
      complete: liveComplete,
      total: liveTotal,
    },
    ibRequestStats,
  };
}

function buildDateFilter(from, to) {
  const filter = {};
  if (from) {
    const d = new Date(from);
    if (!Number.isNaN(d.getTime())) filter.$gte = d;
  }
  if (to) {
    const d = new Date(to);
    if (!Number.isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      filter.$lte = d;
    }
  }
  return Object.keys(filter).length ? filter : null;
}

function paginationOf(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(Math.ceil(total / limit), 1),
  };
}

/** IB portal: paginated deposits of the whole referral network. */
export async function listNetworkDepositsService({
  userId,
  from = null,
  to = null,
  method = "",
  status = "",
  page = 1,
  limit = 20,
}) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");
  const { scopeIds } = await collectScopeUserIds(userId, "total");
  const objectIds = scopeIds.map((id) => new mongoose.Types.ObjectId(id));

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const filter = { user: { $in: objectIds } };
  if (method) filter.method = String(method).toUpperCase();
  if (status) filter.status = String(status).toUpperCase();
  const dateFilter = buildDateFilter(from, to);
  if (dateFilter) filter.createdAt = dateFilter;

  const [items, total, agg] = await Promise.all([
    Deposit.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("user", "name email")
      .populate("account", "account_number account_type")
      .lean(),
    Deposit.countDocuments(filter),
    Deposit.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return {
    items: items.map((d) => ({
      id: String(d._id),
      user: {
        name: d.user?.name || "User",
        email: d.user?.email || "",
      },
      accountNumber: d.account?.account_number || "",
      accountType: d.account?.account_type || "",
      amount: Number(d.amount || 0),
      method: d.method,
      bonusAmount: Number(d.bonus_amount || 0),
      bonusPercent: Number(d.bonus_percent || 0),
      status: d.status,
      proofImage: d.proof?.image_url || "",
      rejectionReason: d.rejectionReason || "",
      createdAt: d.createdAt,
    })),
    pagination: paginationOf(safePage, safeLimit, total),
    totalAmount: Number(agg[0]?.total || 0),
  };
}

/** IB portal: paginated withdrawals of the whole referral network. */
export async function listNetworkWithdrawalsService({
  userId,
  from = null,
  to = null,
  method = "",
  status = "",
  page = 1,
  limit = 20,
}) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");
  const { scopeIds } = await collectScopeUserIds(userId, "total");
  const objectIds = scopeIds.map((id) => new mongoose.Types.ObjectId(id));

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const filter = { user: { $in: objectIds } };
  if (method) filter.method = String(method).toUpperCase();
  if (status) {
    const s = String(status).toUpperCase();
    if (s === "APPROVED") filter.status = { $in: ["APPROVED", "COMPLETED"] };
    else if (s === "REJECTED") filter.status = { $in: ["REJECTED", "FAILED"] };
    else if (s === "PENDING") filter.status = { $in: ["PENDING", "PROCESSING"] };
    else filter.status = s;
  }
  const dateFilter = buildDateFilter(from, to);
  if (dateFilter) filter.createdAt = dateFilter;

  const [items, total, agg] = await Promise.all([
    Withdrawal.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("user", "name email")
      .populate("account", "account_number account_type")
      .lean(),
    Withdrawal.countDocuments(filter),
    Withdrawal.aggregate([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  return {
    items: items.map((w) => ({
      id: String(w._id),
      user: {
        name: w.user?.name || "User",
        email: w.user?.email || "",
      },
      accountNumber: w.account?.account_number || "",
      accountType: w.account?.account_type || "",
      amount: Number(w.amount || 0),
      method: w.method,
      source: w.source || "ACCOUNT",
      payout: w.payout || {},
      status: w.status,
      rejectionReason: w.rejectionReason || "",
      createdAt: w.createdAt,
    })),
    pagination: paginationOf(safePage, safeLimit, total),
    totalAmount: Number(agg[0]?.total || 0),
  };
}

/**
 * IB portal: flat member list of the whole referral network with level,
 * trading stats, deposits, withdrawals and commission. Search + level filter.
 */
export async function listNetworkMembersService({
  userId,
  q = "",
  level = "",
  page = 1,
  limit = 20,
}) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");
  const { scopeIds } = await collectScopeUserIds(userId, "total");
  const objectIds = scopeIds.map((id) => new mongoose.Types.ObjectId(id));

  const referrals = await Referral.find({ user_id: { $in: objectIds } })
    .select("user_id referral_code referred_by status createdAt")
    .lean();

  const refByUser = new Map();
  const childrenMap = new Map();
  for (const r of referrals) {
    const uid = String(r.user_id);
    refByUser.set(uid, r);
    const pid = r.referred_by ? String(r.referred_by) : null;
    if (pid) {
      if (!childrenMap.has(pid)) childrenMap.set(pid, []);
      childrenMap.get(pid).push(uid);
    }
  }

  // BFS levels from root
  const levelMap = new Map([[String(userId), 0]]);
  const queue = [String(userId)];
  while (queue.length) {
    const cur = queue.shift();
    const curLevel = levelMap.get(cur) ?? 0;
    for (const child of childrenMap.get(cur) || []) {
      if (!levelMap.has(child)) {
        levelMap.set(child, curLevel + 1);
        queue.push(child);
      }
    }
  }

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const levelFilter = level !== "" && level !== null && level !== undefined
    ? Number(level)
    : null;
  const search = String(q || "").trim().toLowerCase();

  let memberIds = scopeIds.filter((id) => id !== String(userId));
  if (levelFilter !== null && Number.isFinite(levelFilter)) {
    memberIds = memberIds.filter((id) => (levelMap.get(id) ?? -1) === levelFilter);
  }

  // Fetch users for all filtered members so search works before pagination
  const allMemberObjectIds = memberIds.map((id) => new mongoose.Types.ObjectId(id));
  const allUsers = await User.find({ _id: { $in: allMemberObjectIds } })
    .select("name email createdAt userType ibDashboardEnabled kycStatus")
    .lean();
  const allUserMap = new Map(allUsers.map((u) => [String(u._id), u]));

  let filteredIds = memberIds.filter((id) => allUserMap.has(id));
  if (search) {
    filteredIds = filteredIds.filter((id) => {
      const u = allUserMap.get(id);
      const r = refByUser.get(id);
      const hay = `${u?.name || ""} ${u?.email || ""} ${r?.referral_code || ""}`.toLowerCase();
      return hay.includes(search);
    });
  }

  const total = filteredIds.length;
  const pageIds = filteredIds.slice(skip, skip + safeLimit);
  const pageObjectIds = pageIds.map((id) => new mongoose.Types.ObjectId(id));

  const [depAgg, wdAgg, lotAgg, commAgg] = await Promise.all([
    Deposit.aggregate([
      { $match: { user: { $in: pageObjectIds }, status: "APPROVED" } },
      { $group: { _id: "$user", total: { $sum: "$amount" } } },
    ]),
    Withdrawal.aggregate([
      {
        $match: {
          user: { $in: pageObjectIds },
          status: { $in: ["APPROVED", "COMPLETED"] },
        },
      },
      { $group: { _id: "$user", total: { $sum: "$amount" } } },
    ]),
    Trade.aggregate([
      {
        $match: {
          userId: { $in: pageObjectIds },
          status: { $in: ["CLOSED", "OPEN", "CLOSING"] },
        },
      },
      { $group: { _id: "$userId", lots: { $sum: "$volume" } } },
    ]),
    ReferralReward.aggregate([
      {
        $match: {
          referrer_user: { $in: pageObjectIds },
          status: { $in: ["ELIGIBLE", "REQUESTED", "APPROVED"] },
        },
      },
      { $group: { _id: "$referrer_user", total: { $sum: "$reward_amount" } } },
    ]),
  ]);

  const depMap = new Map(depAgg.map((d) => [String(d._id), Number(d.total || 0)]));
  const wdMap = new Map(wdAgg.map((d) => [String(d._id), Number(d.total || 0)]));
  const lotMap = new Map(lotAgg.map((d) => [String(d._id), Number(d.lots || 0)]));
  const commMap = new Map(commAgg.map((d) => [String(d._id), Number(d.total || 0)]));

  const rows = pageIds
    .map((id) => {
      const u = allUserMap.get(id);
      if (!u) return null;
      const r = refByUser.get(id) || {};
      const isIb = Boolean(u.ibDashboardEnabled) || (childrenMap.get(id) || []).length > 0;
      return {
        id,
        name: u.name || "User",
        email: u.email || "",
        level: levelMap.get(id) ?? 0,
        referralCode: r.referral_code || "—",
        userType: isIb ? "IB" : "Client",
        lots: lotMap.get(id) || 0,
        commission: commMap.get(id) || 0,
        totalDeposit: depMap.get(id) || 0,
        totalWithdrawal: wdMap.get(id) || 0,
        registeredAt: u.createdAt || r.createdAt || null,
        remark: r.status || "—",
        kycStatus: u.kycStatus || "NOT_STARTED",
      };
    })
    .filter(Boolean);

  return {
    items: rows,
    pagination: paginationOf(safePage, safeLimit, total),
    levels: [...new Set([...levelMap.values()])].sort((a, b) => a - b),
  };
}

/**
 * IB portal: KYC records of the whole referral network.
 * Columns: name, email, mobile, KYC type, request date, action date,
 * action by, user type, status. Search + status filter + pagination.
 */
export async function listNetworkKycService({
  userId,
  q = "",
  status = "",
  page = 1,
  limit = 20,
}) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");
  const { scopeIds } = await collectScopeUserIds(userId, "total");
  const objectIds = scopeIds.map((id) => new mongoose.Types.ObjectId(id));

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const search = String(q || "").trim().toLowerCase();

  const filter = { user: { $in: objectIds } };
  const st = String(status || "").toUpperCase();
  if (["PENDING", "VERIFIED", "REJECTED"].includes(st)) filter.status = st;

  // Search needs user fields -> fetch matching user ids first
  let userFilter = null;
  if (search) {
    const matchedUsers = await User.find({
      _id: { $in: objectIds },
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();
    userFilter = matchedUsers.map((u) => u._id);
    filter.user = { $in: userFilter.length ? userFilter : [new mongoose.Types.ObjectId("000000000000000000000000")] };
  }

  const [items, total, counts] = await Promise.all([
    Kyc.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("user", "name email phone ibDashboardEnabled")
      .lean(),
    Kyc.countDocuments(filter),
    Kyc.aggregate([
      { $match: { user: { $in: objectIds } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const statusCounts = { PENDING: 0, VERIFIED: 0, REJECTED: 0 };
  for (const c of counts) {
    if (c._id && statusCounts[c._id] !== undefined) statusCounts[c._id] = c.count;
  }

  return {
    items: items.map((k) => ({
      id: String(k._id),
      name: k.user?.name || "User",
      email: k.user?.email || "",
      phone: k.user?.phone || "",
      kycType: k.documentType || "—",
      requestDate: k.createdAt,
      actionDate: k.status === "PENDING" ? null : k.updatedAt,
      actionBy: k.status === "PENDING" ? "—" : "Admin",
      userType: k.user?.ibDashboardEnabled ? "IB" : "Client",
      status: k.status,
      remark: k.status === "REJECTED" ? k.rejectionReason || "—" : "—",
      documents: {
        front: k.documents?.front?.image_url || "",
        back: k.documents?.back?.image_url || "",
        selfie: k.documents?.selfie?.image_url || "",
      },
    })),
    statusCounts,
    pagination: paginationOf(safePage, safeLimit, total),
  };
}

/**
 * IB portal: live trading accounts of the referral network.
 * Total balance box + table with request time, action by, remark.
 */
export async function listNetworkAccountsService({
  userId,
  q = "",
  page = 1,
  limit = 20,
}) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");
  const { scopeIds } = await collectScopeUserIds(userId, "total");
  const objectIds = scopeIds.map((id) => new mongoose.Types.ObjectId(id));

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;
  const search = String(q || "").trim().toLowerCase();

  const filter = { user_id: { $in: objectIds }, account_type: "live" };
  if (search) {
    filter.$or = [
      { account_number: { $regex: search, $options: "i" } },
      { plan_name: { $regex: search, $options: "i" } },
    ];
  }

  const [items, total, balanceAgg] = await Promise.all([
    Account.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("user_id", "name email phone ibDashboardEnabled")
      .lean(),
    Account.countDocuments(filter),
    Account.aggregate([
      {
        $match: {
          user_id: { $in: objectIds },
          account_type: "live",
          status: "active",
        },
      },
      { $group: { _id: null, total: { $sum: "$balance" } } },
    ]),
  ]);

  return {
    items: items.map((a) => ({
      id: String(a._id),
      name: a.user_id?.name || "User",
      email: a.user_id?.email || "",
      phone: a.user_id?.phone || "",
      accountNumber: a.account_number,
      accountType: a.account_type,
      leverage: a.leverage ? `1:${a.leverage}` : "—",
      balance: Number(a.balance || 0),
      currency: a.currency || "USD",
      requestTime: a.createdAt,
      actionBy: "System",
      userType: a.user_id?.ibDashboardEnabled ? "IB" : "Client",
      remark: `${a.plan_name || "—"} · ${a.status || "active"}`,
      status: a.status,
      planName: a.plan_name || "",
      equity: Number(a.equity || 0),
      bonusBalance: Number(a.bonus_balance || 0),
    })),
    totalBalance: Number(balanceAgg[0]?.total || 0),
    pagination: paginationOf(safePage, safeLimit, total),
  };
}

/**
 * Downline tree for the logged-in IB (My Clients page).
 * BFS over Referral.referred_by, depth-capped, returns nested children.
 */
export async function getMyReferralTreeService({ userId, maxDepth = 6 }) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }
  const safeDepth = Math.min(Math.max(Number(maxDepth) || 6, 1), 8);
  const MAX_NODES = 400;

  const root = await Referral.findOne({ user_id: userId })
    .populate("user_id", "name email phone")
    .lean();

  // level -> map parentId -> children[]
  const nodes = new Map(); // userId -> { userId, name, email, level, children: [] }
  const rootId = String(userId);
  nodes.set(rootId, {
    userId: rootId,
    name: root?.user_id?.name || "You",
    email: root?.user_id?.email || "",
    phone: root?.user_id?.phone || "",
    level: 0,
    children: [],
  });

  let frontier = [rootId];
  let level = 0;
  let totalNodes = 1;

  while (frontier.length && level < safeDepth && totalNodes < MAX_NODES) {
    const batch = frontier.splice(0, frontier.length);
    const kids = await Referral.find({
      referred_by: { $in: batch.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .populate("user_id", "name email phone")
      .select("user_id referred_by createdAt")
      .lean();

    const next = [];
    for (const k of kids) {
      const kidId = k.user_id?._id ? String(k.user_id._id) : null;
      if (!kidId || nodes.has(kidId)) continue;
      if (totalNodes >= MAX_NODES) break;
      const parentId = String(k.referred_by || "");
      const parent = nodes.get(parentId);
      if (!parent) continue;
      const node = {
        userId: kidId,
        name: k.user_id?.name || "User",
        email: k.user_id?.email || "",
        phone: k.user_id?.phone || "",
        level: level + 1,
        children: [],
      };
      nodes.set(kidId, node);
      parent.children.push(node);
      next.push(kidId);
      totalNodes += 1;
    }
    frontier = next;
    level += 1;
  }

  const rootNode = nodes.get(rootId);
  const directCount = rootNode?.children?.length || 0;
  const networkSize = totalNodes - 1;

  return {
    root: rootNode,
    stats: {
      directReferrals: directCount,
      networkSize,
      maxDepth: safeDepth,
      truncated: totalNodes >= MAX_NODES,
    },
  };
}
