import mongoose from 'mongoose';
import ActivityLog from '../models/ActivityLog.model.js';

export const ACTIVITY_ACTIONS = Object.freeze({
  USER_CREATED: 'USER_CREATED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED_BY_ADMIN: 'PASSWORD_CHANGED_BY_ADMIN',
  TRADE_CLOSED_EDITED_BY_ADMIN: 'TRADE_CLOSED_EDITED_BY_ADMIN',
  TRADE_DELETED_BY_ADMIN: 'TRADE_DELETED_BY_ADMIN',
  TRADE_RESTORED_BY_ADMIN: 'TRADE_RESTORED_BY_ADMIN'
});

export const ACTOR_TYPES = Object.freeze({
  SELF: 'SELF',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM'
});

function parseCursor(before) {
  if (!before || typeof before !== 'string') return null;

  const trimmed = before.trim();
  if (!trimmed) return null;

  if (trimmed.includes('|')) {
    const parts = trimmed.split('|');
    const datePart = parts[0]?.trim();
    const idPart = parts[1]?.trim();

    const beforeDate = new Date(datePart);
    if (Number.isNaN(beforeDate.getTime())) {
      throw new Error('Invalid before cursor');
    }

    if (!mongoose.isValidObjectId(idPart)) {
      throw new Error('Invalid before cursor');
    }

    return {
      type: 'composite',
      date: beforeDate,
      id: new mongoose.Types.ObjectId(idPart)
    };
  }

  const beforeDate = new Date(trimmed);
  if (Number.isNaN(beforeDate.getTime())) {
    throw new Error('Invalid before cursor');
  }

  return { type: 'date', date: beforeDate };
}

function applyCursorFilter(filter, before) {
  const cursor = parseCursor(before);
  if (!cursor) return;

  if (cursor.type === 'date') {
    filter.createdAt = { $lt: cursor.date };
    return;
  }

  filter.$or = [
    { createdAt: { $lt: cursor.date } },
    { createdAt: cursor.date, _id: { $lt: cursor.id } }
  ];
}

export async function recordActivity({
  userId,
  action,
  actorId = null,
  actorType = ACTOR_TYPES.SYSTEM
}) {
  if (!mongoose.isValidObjectId(userId)) return null;
  if (!action) return null;

  const payload = {
    user_id: userId,
    action,
    actor_type: actorType
  };

  if (actorId && mongoose.isValidObjectId(actorId)) {
    payload.actor_id = actorId;
  }

  return ActivityLog.create(payload);
}

export async function getUserActivityService({
  userId,
  limit = 20,
  before = null,
  includeUser = false
}) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error('Invalid userId');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

  const filter = { user_id: userId };

  applyCursorFilter(filter, before);

  let query = ActivityLog.find(filter)
    .select('_id user_id action actor_type createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1);

  if (includeUser) {
    query = query.populate('user_id', 'name email');
  }

  const docs = await query.lean();

  const hasMore = docs.length > safeLimit;
  const rawItems = hasMore ? docs.slice(0, safeLimit) : docs;
  const items = includeUser
    ? rawItems.map((item) => {
        const user =
          item.user_id && typeof item.user_id === 'object'
            ? item.user_id
            : null;

        return {
          ...item,
          user_id: user?._id ?? item.user_id,
          user_name: user?.name || null,
          user_email: user?.email || null
        };
      })
    : rawItems;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem
      ? `${lastItem.createdAt.toISOString()}|${String(lastItem._id)}`
      : null;

  return {
    items,
    nextCursor,
    limit: safeLimit
  };
}

export async function getAllActivityService({
  limit = 20,
  before = null,
  action = null,
  userId = null,
  actorType = null,
  includeUser = false
}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

  const filter = {};

  if (action && typeof action === 'string') {
    filter.action = action.trim().toUpperCase();
  }

  if (actorType && typeof actorType === 'string') {
    filter.actor_type = actorType.trim().toUpperCase();
  }

  if (userId) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new Error('Invalid userId');
    }
    filter.user_id = userId;
  }

  applyCursorFilter(filter, before);

  let query = ActivityLog.find(filter)
    .select('_id user_id action actor_type actor_id createdAt')
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1);

  if (includeUser) {
    query = query.populate('user_id', 'name email');
  }

  const docs = await query.lean();

  const hasMore = docs.length > safeLimit;
  const rawItems = hasMore ? docs.slice(0, safeLimit) : docs;
  const items = includeUser
    ? rawItems.map((item) => {
        const user =
          item.user_id && typeof item.user_id === 'object'
            ? item.user_id
            : null;

        return {
          ...item,
          user_id: user?._id ?? item.user_id,
          user_name: user?.name || null,
          user_email: user?.email || null
        };
      })
    : rawItems;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem
      ? `${lastItem.createdAt.toISOString()}|${String(lastItem._id)}`
      : null;

  return {
    items,
    nextCursor,
    limit: safeLimit
  };
}
