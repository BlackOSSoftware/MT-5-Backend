import mongoose from "mongoose";
import Referral from "../models/Referral.model.js";
import User from "../models/User.model.js";
import {
  buildChildrenMap,
  buildReferralLinks,
  buildReferralTree,
  computeGlobalLevelCounts,
  normalizeId,
  summarizeDownline,
} from "./referralReport.helpers.js";
import {
  assertUserBelongsToBroker,
  getBrokerUserIds,
} from "../utils/brokerScope.js";

function toUserCard(user) {
  if (!user) return null;
  return {
    _id: String(user._id),
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || "",
    kycStatus: user.kycStatus || null,
    isMailVerified: Boolean(user.isMailVerified),
  };
}

async function loadAllReferralRows(brokerId = null) {
  const filter = {};
  if (brokerId) {
    const brokerUserIds = await getBrokerUserIds(brokerId);
    filter.user_id = { $in: brokerUserIds || [] };
  }
  return Referral.find(filter)
    .select("user_id referred_by referral_code status total_referrals total_earned referral_balance createdAt")
    .lean();
}

async function loadUsersByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (!unique.length) return new Map();
  const users = await User.find({ _id: { $in: unique } })
    .select("_id name email phone kycStatus isMailVerified")
    .lean();
  const map = new Map();
  for (const u of users) {
    map.set(String(u._id), toUserCard(u));
  }
  return map;
}

function rowsForHelpers(docs) {
  return docs.map((d) => ({
    userId: String(d.user_id),
    referredBy: d.referred_by ? String(d.referred_by) : null,
    referral_code: d.referral_code,
    status: d.status,
    createdAt: d.createdAt,
    total_referrals: d.total_referrals,
    total_earned: d.total_earned,
    referral_balance: d.referral_balance,
  }));
}

export async function adminReferralNetworkSummaryService({
  brokerId = null,
} = {}) {
  const docs = await loadAllReferralRows(brokerId);
  const rows = rowsForHelpers(docs);
  const global = computeGlobalLevelCounts(rows);

  return {
    totalProfiles: docs.length,
    linkedUsers: global.linkedUsers,
    totalReferrers: global.totalReferrers,
    levelCounts: global.levelCounts,
    unlinkedUsers: Math.max(docs.length - global.linkedUsers, 0),
  };
}

/**
 * Paginated referrer leaderboard + optional search.
 * Only users who have at least one direct referral (or q matches a user).
 */
export async function adminListReferralNetworkService({
  q = "",
  page = 1,
  limit = 20,
  onlyReferrers = true,
  brokerId = null,
} = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const docs = await loadAllReferralRows(brokerId);
  const rows = rowsForHelpers(docs);
  const childrenByParent = buildChildrenMap(rows);

  const profileByUser = new Map();
  for (const d of docs) {
    profileByUser.set(String(d.user_id), d);
  }

  let candidateIds;
  if (onlyReferrers) {
    candidateIds = [...childrenByParent.keys()];
  } else {
    candidateIds = docs.map((d) => String(d.user_id));
  }

  const search = String(q || "").trim().toLowerCase();
  let usersById = await loadUsersByIds([
    ...candidateIds,
    ...rows.map((r) => r.referredBy).filter(Boolean),
  ]);

  if (search) {
    candidateIds = candidateIds.filter((id) => {
      const u = usersById.get(id);
      if (!u) return false;
      const hay = `${u.name} ${u.email} ${u.phone}`.toLowerCase();
      const code = String(profileByUser.get(id)?.referral_code || "").toLowerCase();
      return hay.includes(search) || code.includes(search);
    });
  }

  const enriched = candidateIds.map((userId) => {
    const stats = summarizeDownline(userId, childrenByParent);
    const profile = profileByUser.get(userId);
    const parentId = profile?.referred_by ? String(profile.referred_by) : null;
    return {
      userId,
      user: usersById.get(userId) || { _id: userId },
      referralCode: profile?.referral_code || null,
      status: profile?.status || null,
      referredBy: parentId
        ? usersById.get(parentId) || { _id: parentId }
        : null,
      directReferrals: stats.directReferrals,
      networkSize: stats.networkSize,
      levelBreakdown: stats.levelBreakdown,
      maxDepth: stats.maxDepth,
      totalEarned: Number(profile?.total_earned) || 0,
      referralBalance: Number(profile?.referral_balance) || 0,
      createdAt: profile?.createdAt || null,
    };
  });

  enriched.sort((a, b) => {
    if (b.directReferrals !== a.directReferrals) {
      return b.directReferrals - a.directReferrals;
    }
    return b.networkSize - a.networkSize;
  });

  const total = enriched.length;
  const start = (safePage - 1) * safeLimit;
  const items = enriched.slice(start, start + safeLimit);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

/**
 * Flat who-referred-whom list.
 */
export async function adminListReferralLinksService({
  q = "",
  page = 1,
  limit = 20,
  brokerId = null,
} = {}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const docs = await loadAllReferralRows(brokerId);
  const rows = rowsForHelpers(docs);
  const userIds = [];
  for (const r of rows) {
    userIds.push(r.userId);
    if (r.referredBy) userIds.push(r.referredBy);
  }
  const usersById = await loadUsersByIds(userIds);
  let links = buildReferralLinks(rows, usersById);

  const search = String(q || "").trim().toLowerCase();
  if (search) {
    links = links.filter((link) => {
      const a = `${link.referrer?.name || ""} ${link.referrer?.email || ""}`.toLowerCase();
      const b = `${link.referred?.name || ""} ${link.referred?.email || ""}`.toLowerCase();
      const code = String(link.referralCode || "").toLowerCase();
      return a.includes(search) || b.includes(search) || code.includes(search);
    });
  }

  links.sort((x, y) => {
    const tx = x.createdAt ? new Date(x.createdAt).getTime() : 0;
    const ty = y.createdAt ? new Date(y.createdAt).getTime() : 0;
    return ty - tx;
  });

  const total = links.length;
  const start = (safePage - 1) * safeLimit;
  const items = links.slice(start, start + safeLimit);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

/**
 * Full tree for one user: Person → their referrals → nested.
 */
export async function adminGetReferralTreeService(
  userId,
  { maxDepth = 8, brokerId = null } = {},
) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  await assertUserBelongsToBroker(userId, brokerId);

  const safeDepth = Math.min(Math.max(Number(maxDepth) || 8, 1), 15);
  const docs = await loadAllReferralRows(brokerId);
  const rows = rowsForHelpers(docs);
  const childrenByParent = buildChildrenMap(rows);
  const stats = summarizeDownline(userId, childrenByParent, safeDepth);

  const collectIds = new Set([String(userId)]);
  const queue = [{ id: String(userId), level: 0 }];
  while (queue.length) {
    const { id, level } = queue.shift();
    if (level >= safeDepth) continue;
    for (const child of childrenByParent.get(id) || []) {
      if (collectIds.has(child)) continue;
      collectIds.add(child);
      queue.push({ id: child, level: level + 1 });
    }
  }

  const rootProfile = docs.find((d) => String(d.user_id) === String(userId));
  const parentId = rootProfile?.referred_by
    ? String(rootProfile.referred_by)
    : null;
  if (parentId) collectIds.add(parentId);

  const usersById = await loadUsersByIds([...collectIds]);
  // Attach referral codes onto user cards for tree display
  for (const d of docs) {
    const id = String(d.user_id);
    if (!usersById.has(id)) continue;
    usersById.set(id, {
      ...usersById.get(id),
      referralCode: d.referral_code || null,
      referralStatus: d.status || null,
    });
  }

  const tree = buildReferralTree(
    userId,
    childrenByParent,
    usersById,
    safeDepth,
  );

  return {
    root: {
      user: usersById.get(String(userId)) || { _id: String(userId) },
      referralCode: rootProfile?.referral_code || null,
      status: rootProfile?.status || null,
      referredBy: parentId
        ? usersById.get(parentId) || { _id: parentId }
        : null,
      totalEarned: Number(rootProfile?.total_earned) || 0,
      referralBalance: Number(rootProfile?.referral_balance) || 0,
    },
    stats: {
      directReferrals: stats.directReferrals,
      networkSize: stats.networkSize,
      levelBreakdown: stats.levelBreakdown,
      maxDepth: stats.maxDepth,
    },
    tree,
  };
}

export {
  buildChildrenMap,
  buildReferralTree,
  summarizeDownline,
  normalizeId,
};
