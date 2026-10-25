/**
 * Pure helpers for admin referral network reports.
 * Rows shape: { userId: string, referredBy: string|null }
 */

export function normalizeId(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id != null) {
    return String(value._id);
  }
  return String(value);
}

/**
 * Build adjacency: referrerUserId -> [childUserIds]
 */
export function buildChildrenMap(rows = []) {
  const childrenByParent = new Map();
  for (const row of rows) {
    const userId = normalizeId(row.userId ?? row.user_id);
    const parentId = normalizeId(row.referredBy ?? row.referred_by);
    if (!userId) continue;
    if (!parentId) continue;
    if (!childrenByParent.has(parentId)) {
      childrenByParent.set(parentId, []);
    }
    childrenByParent.get(parentId).push(userId);
  }
  return childrenByParent;
}

/**
 * Count direct children for every parent in the map.
 */
export function countDirectReferrals(childrenByParent) {
  const counts = new Map();
  for (const [parentId, kids] of childrenByParent.entries()) {
    counts.set(parentId, kids.length);
  }
  return counts;
}

/**
 * Walk downline from root. Returns network size (excl. root),
 * levelBreakdown (level -> count), and maxDepth.
 * Level 1 = direct referrals.
 */
export function summarizeDownline(rootUserId, childrenByParent, maxDepth = 20) {
  const root = normalizeId(rootUserId);
  const levelBreakdown = {};
  let networkSize = 0;
  let maxObserved = 0;

  if (!root) {
    return { networkSize: 0, levelBreakdown, maxDepth: 0 };
  }

  const queue = [{ id: root, level: 0 }];
  const visited = new Set([root]);

  while (queue.length) {
    const { id, level } = queue.shift();
    if (level >= maxDepth) continue;
    const kids = childrenByParent.get(id) || [];
    for (const childId of kids) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      const childLevel = level + 1;
      levelBreakdown[childLevel] = (levelBreakdown[childLevel] || 0) + 1;
      networkSize += 1;
      if (childLevel > maxObserved) maxObserved = childLevel;
      queue.push({ id: childId, level: childLevel });
    }
  }

  return {
    networkSize,
    levelBreakdown,
    maxDepth: maxObserved,
    directReferrals: levelBreakdown[1] || 0,
  };
}

/**
 * Build nested tree for UI.
 * usersById: Map|Record of userId -> { _id, name, email, phone, referralCode, ... }
 */
export function buildReferralTree(
  rootUserId,
  childrenByParent,
  usersById = new Map(),
  maxDepth = 8,
) {
  const root = normalizeId(rootUserId);
  const lookup = (id) => {
    if (!id) return null;
    if (usersById instanceof Map) return usersById.get(id) || { _id: id };
    return usersById[id] || { _id: id };
  };

  const walk = (id, level, path) => {
    const nodeUser = lookup(id);
    const kids =
      level >= maxDepth ? [] : childrenByParent.get(id) || [];
    const children = [];
    for (const childId of kids) {
      if (path.has(childId)) continue; // cycle guard
      const nextPath = new Set(path);
      nextPath.add(childId);
      children.push(walk(childId, level + 1, nextPath));
    }
    return {
      userId: id,
      level,
      user: nodeUser,
      directReferrals: (childrenByParent.get(id) || []).length,
      children,
    };
  };

  if (!root) {
    return null;
  }

  return walk(root, 0, new Set([root]));
}

/**
 * Flat edges: who referred whom (for table report).
 */
export function buildReferralLinks(rows = [], usersById = new Map()) {
  const lookup = (id) => {
    if (!id) return null;
    if (usersById instanceof Map) return usersById.get(id) || { _id: id };
    return usersById[id] || { _id: id };
  };

  const links = [];
  for (const row of rows) {
    const userId = normalizeId(row.userId ?? row.user_id);
    const parentId = normalizeId(row.referredBy ?? row.referred_by);
    if (!userId || !parentId) continue;
    links.push({
      referrerUserId: parentId,
      referredUserId: userId,
      referrer: lookup(parentId),
      referred: lookup(userId),
      referralCode: row.referral_code || row.referralCode || null,
      status: row.status || null,
      createdAt: row.createdAt || null,
    });
  }
  return links;
}

/**
 * Global level histogram across whole network (depth from each root orphan).
 * Simpler: for every linked user, depth = distance to topmost ancestor.
 */
export function computeGlobalLevelCounts(rows = [], maxDepth = 20) {
  const childrenByParent = buildChildrenMap(rows);
  const parentByUser = new Map();
  const allUsers = new Set();

  for (const row of rows) {
    const userId = normalizeId(row.userId ?? row.user_id);
    const parentId = normalizeId(row.referredBy ?? row.referred_by);
    if (!userId) continue;
    allUsers.add(userId);
    if (parentId) {
      parentByUser.set(userId, parentId);
      allUsers.add(parentId);
    }
  }

  const depthOf = (userId) => {
    let depth = 0;
    let cur = userId;
    const seen = new Set();
    while (parentByUser.has(cur) && depth < maxDepth) {
      if (seen.has(cur)) break;
      seen.add(cur);
      cur = parentByUser.get(cur);
      depth += 1;
    }
    return depth;
  };

  const levelCounts = {};
  let linkedUsers = 0;
  for (const userId of allUsers) {
    if (!parentByUser.has(userId)) continue;
    linkedUsers += 1;
    const depth = depthOf(userId);
    levelCounts[depth] = (levelCounts[depth] || 0) + 1;
  }

  const referrerIds = new Set(childrenByParent.keys());

  return {
    linkedUsers,
    totalReferrers: referrerIds.size,
    levelCounts,
    childrenByParent,
  };
}
