import mongoose from "mongoose";
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

/** Resolve a user's brokerId (for stamping deposits/withdrawals/trades). */
export async function getUserBrokerId(userId) {
  if (!userId) return null;
  const user = await User.findById(userId).select("brokerId").lean();
  if (user?.brokerId) return user.brokerId;

  // Last resort: platform default broker (FPTrade / BLACKOS) + heal the user.
  const defaultId = String(process.env.DEFAULT_BROKER_ID || "").trim();
  if (defaultId && mongoose.isValidObjectId(defaultId)) {
    try {
      await User.updateOne(
        {
          _id: userId,
          userType: "USER",
          $or: [{ brokerId: null }, { brokerId: { $exists: false } }],
        },
        { $set: { brokerId: defaultId } },
      );
    } catch {
      /* non-fatal */
    }
    return new mongoose.Types.ObjectId(defaultId);
  }
  return null;
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

function toObjectId(id) {
  if (!id) return null;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const s = String(id);
  if (!mongoose.isValidObjectId(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

/**
 * Apply broker scope onto a Mongo match that keys users by `userField`.
 * When a specific user id is already set, verifies it belongs to the broker.
 *
 * Also ORs with document-level `brokerId` so legacy rows stamped with the
 * broker still show even if User.brokerId was healed later / vice versa.
 */
export async function applyBrokerUserIdMatch(
  match,
  brokerId,
  userField = "userId",
) {
  if (!brokerId) return match;

  const ids = await getBrokerUserIds(brokerId);
  const brokerOid = toObjectId(brokerId);

  // Specific user requested — must belong to this broker.
  if (
    match[userField] != null &&
    typeof match[userField] !== "object"
  ) {
    const requested = String(match[userField]);
    const ok = (ids || []).some((id) => String(id) === requested);
    match[userField] = ok ? match[userField] : { $in: [] };
    return match;
  }

  if (
    match[userField] != null &&
    match[userField] instanceof mongoose.Types.ObjectId
  ) {
    const requested = String(match[userField]);
    const ok = (ids || []).some((id) => String(id) === requested);
    match[userField] = ok ? match[userField] : { $in: [] };
    return match;
  }

  const orClause = [];
  if (ids?.length) {
    orClause.push({ [userField]: { $in: ids } });
  }
  if (brokerOid) {
    orClause.push({ brokerId: brokerOid });
  }

  if (!orClause.length) {
    match[userField] = { $in: [] };
    return match;
  }

  // Keep existing top-level filters; nest broker scope under $and.
  if (!match.$and) match.$and = [];
  match.$and.push({ $or: orClause });
  return match;
}

/**
 * Backfill Deposit/Withdrawal/etc. brokerId from the owning User.
 * Call from broker-admin list endpoints so legacy rows become visible.
 */
export async function healDocBrokerIdsFromUsers(Model, userField = "user") {
  if (!Model?.collection?.name) return 0;

  const orphans = await Model.find({
    $or: [{ brokerId: null }, { brokerId: { $exists: false } }],
  })
    .select(`_id ${userField}`)
    .limit(500)
    .lean();

  if (!orphans.length) return 0;

  const userIds = [
    ...new Set(
      orphans
        .map((d) => String(d[userField] || ""))
        .filter((id) => mongoose.isValidObjectId(id)),
    ),
  ];

  if (!userIds.length) return 0;

  const users = await User.find({
    _id: { $in: userIds },
    brokerId: { $ne: null },
  })
    .select("_id brokerId")
    .lean();

  const byUser = new Map(users.map((u) => [String(u._id), u.brokerId]));

  const ops = [];
  for (const doc of orphans) {
    const bid = byUser.get(String(doc[userField]));
    if (!bid) continue;
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { brokerId: bid } },
      },
    });
  }

  if (!ops.length) return 0;
  const result = await Model.bulkWrite(ops, { ordered: false });
  return result.modifiedCount || 0;
}
