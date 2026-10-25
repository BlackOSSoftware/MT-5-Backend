import User from "../models/User.model.js";

/**
 * Resolve user ObjectIds for a broker.
 * @returns {null} when no broker scope (SuperAdmin all-data)
 * @returns {ObjectId[]} when scoped (may be empty)
 */
export async function getBrokerUserIds(brokerId) {
  if (!brokerId) return null;
  const users = await User.find({ brokerId }).select("_id").lean();
  return users.map((u) => u._id);
}

/** Apply user-owner filter when broker-scoped. */
export function applyUserScope(filter, userIds, userField = "user") {
  if (userIds === null) return filter;
  return {
    ...filter,
    [userField]: { $in: userIds },
  };
}

export function assertBrokerOwnedUser(user, brokerId) {
  if (!brokerId) return true;
  if (!user) return false;
  return String(user.brokerId || "") === String(brokerId);
}

/** Merge brokerId into query object for list services (SuperAdmin: unchanged). */
export function withBrokerQuery(req, query = {}) {
  if (req?.brokerId) {
    return { ...query, brokerId: String(req.brokerId) };
  }
  return { ...query };
}

/** Throw if userId is outside broker scope. */
export async function assertUserBelongsToBroker(userId, brokerId) {
  if (!brokerId) return;
  const user = await User.findById(userId).select("brokerId").lean();
  if (!assertBrokerOwnedUser(user, brokerId)) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
}

/**
 * Apply broker scope onto a Mongo match that keys users by `userField`.
 * When a specific user id is already set, verifies it belongs to the broker.
 */
export async function applyBrokerUserIdMatch(match, brokerId, userField = "userId") {
  if (!brokerId) return match;
  const ids = await getBrokerUserIds(brokerId);
  if (!ids.length) {
    match[userField] = { $in: [] };
    return match;
  }
  if (match[userField] != null) {
    const requested = String(match[userField]);
    const ok = ids.some((id) => String(id) === requested);
    match[userField] = ok
      ? match[userField]
      : { $in: [] };
    return match;
  }
  match[userField] = { $in: ids };
  return match;
}
