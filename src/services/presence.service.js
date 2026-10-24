import User from "../models/User.model.js";

/** If no heartbeat within this window, treat as offline in admin reads. */
export const PRESENCE_STALE_MS = 30_000;

export function isPresenceFresh(lastSeenAt, now = Date.now()) {
  if (!lastSeenAt) return false;
  const ts = new Date(lastSeenAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return now - ts <= PRESENCE_STALE_MS;
}

export function resolveIsOnline(user, now = Date.now()) {
  if (!user) return false;
  return user.isOnline === true && isPresenceFresh(user.lastSeenAt, now);
}

export async function markUserOnline(userId) {
  if (!userId) return null;
  const now = new Date();
  return User.findByIdAndUpdate(
    userId,
    { $set: { isOnline: true, lastSeenAt: now } },
    { new: true }
  )
    .select("_id isOnline lastSeenAt")
    .lean();
}

export async function markUserOffline(userId) {
  if (!userId) return null;
  const now = new Date();
  return User.findByIdAndUpdate(
    userId,
    { $set: { isOnline: false, lastSeenAt: now } },
    { new: true }
  )
    .select("_id isOnline lastSeenAt")
    .lean();
}

export function attachPresenceFields(user, now = Date.now()) {
  if (!user || typeof user !== "object") return user;
  return {
    ...user,
    isOnline: resolveIsOnline(user, now),
    lastSeenAt: user.lastSeenAt || null,
  };
}
