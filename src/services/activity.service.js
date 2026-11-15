import mongoose from 'mongoose';
import ActivityLog, { ACTIVITY_CATEGORIES } from '../models/ActivityLog.model.js';
import User from '../models/User.model.js';

export const ACTIVITY_ACTIONS = Object.freeze({
  USER_CREATED: 'USER_CREATED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  PASSWORD_CHANGED_BY_ADMIN: 'PASSWORD_CHANGED_BY_ADMIN',
  TRADE_CLOSED_EDITED_BY_ADMIN: 'TRADE_CLOSED_EDITED_BY_ADMIN',
  TRADE_DELETED_BY_ADMIN: 'TRADE_DELETED_BY_ADMIN',
  TRADE_RESTORED_BY_ADMIN: 'TRADE_RESTORED_BY_ADMIN',
  KYC_APPROVED: 'KYC_APPROVED',
  KYC_REJECTED: 'KYC_REJECTED',
  KYC_SUBMITTED: 'KYC_SUBMITTED',
  DEPOSIT_APPROVED: 'DEPOSIT_APPROVED',
  DEPOSIT_REJECTED: 'DEPOSIT_REJECTED',
  DEPOSIT_CREATED_BY_ADMIN: 'DEPOSIT_CREATED_BY_ADMIN',
  DEPOSIT_AMOUNT_EDITED: 'DEPOSIT_AMOUNT_EDITED',
  DEPOSIT_REQUESTED: 'DEPOSIT_REQUESTED',
  WITHDRAWAL_APPROVED: 'WITHDRAWAL_APPROVED',
  WITHDRAWAL_REJECTED: 'WITHDRAWAL_REJECTED',
  WITHDRAWAL_CREATED_BY_ADMIN: 'WITHDRAWAL_CREATED_BY_ADMIN',
  WITHDRAWAL_REQUESTED: 'WITHDRAWAL_REQUESTED',
  TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',
  TRADE_OPENED_BY_ADMIN: 'TRADE_OPENED_BY_ADMIN',
  TRADE_CLOSED_BY_ADMIN: 'TRADE_CLOSED_BY_ADMIN',
  TRADE_MODIFIED_BY_ADMIN: 'TRADE_MODIFIED_BY_ADMIN',
  USER_UPDATED_BY_ADMIN: 'USER_UPDATED_BY_ADMIN',
  USER_DELETED_BY_ADMIN: 'USER_DELETED_BY_ADMIN',
  USER_PROFILE_VIEWED: 'USER_PROFILE_VIEWED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  ADMIN_CREATED: 'ADMIN_CREATED',
  ADMIN_UPDATED: 'ADMIN_UPDATED',
  ADMIN_DELETED: 'ADMIN_DELETED',
  ACCOUNT_OPENED: 'ACCOUNT_OPENED',
  INQUIRY_SUBMITTED: 'INQUIRY_SUBMITTED',
  INQUIRY_REVIEWED: 'INQUIRY_REVIEWED',
  INQUIRY_CLOSED: 'INQUIRY_CLOSED',
  PLAN_CREATED: 'PLAN_CREATED',
  PLAN_UPDATED: 'PLAN_UPDATED',
  PLAN_DELETED: 'PLAN_DELETED',
  INSTRUMENT_CREATED: 'INSTRUMENT_CREATED',
  INSTRUMENT_UPDATED: 'INSTRUMENT_UPDATED',
  INSTRUMENT_DELETED: 'INSTRUMENT_DELETED',
  PAYMENT_METHOD_CREATED: 'PAYMENT_METHOD_CREATED',
  PAYMENT_METHOD_UPDATED: 'PAYMENT_METHOD_UPDATED',
  PAYMENT_METHOD_STATUS_CHANGED: 'PAYMENT_METHOD_STATUS_CHANGED',
  PAYMENT_METHOD_DELETED: 'PAYMENT_METHOD_DELETED',
  HOLIDAY_CREATED: 'HOLIDAY_CREATED',
  HOLIDAY_UPDATED: 'HOLIDAY_UPDATED',
  HOLIDAY_DELETED: 'HOLIDAY_DELETED',
  CONVERSION_RATES_UPDATED: 'CONVERSION_RATES_UPDATED',
  WITHDRAW_METHODS_UPDATED: 'WITHDRAW_METHODS_UPDATED',
  BONUS_SETTINGS_UPDATED: 'BONUS_SETTINGS_UPDATED',
  BONUS_CREDITED: 'BONUS_CREDITED',
  TRADABLE_FUND_CREDITED: 'TRADABLE_FUND_CREDITED',
  WALLET_ADJUSTED: 'WALLET_ADJUSTED',
  IB_LEVELS_UPDATED: 'IB_LEVELS_UPDATED',
  IB_DASHBOARD_UPDATED: 'IB_DASHBOARD_UPDATED',
  BROKER_RISK_UPDATED: 'BROKER_RISK_UPDATED',
  SLIPPAGE_UPDATED: 'SLIPPAGE_UPDATED',
  PLAN_SPREAD_UPDATED: 'PLAN_SPREAD_UPDATED',
  SYMBOLS_BULK_ADDED: 'SYMBOLS_BULK_ADDED',
  NOTIFICATION_BROADCAST: 'NOTIFICATION_BROADCAST',
  NOTIFICATION_SENT: 'NOTIFICATION_SENT',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT'
});

export const ACTOR_TYPES = Object.freeze({
  SELF: 'SELF',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM'
});

export { ACTIVITY_CATEGORIES };

const ACTION_CATEGORY_MAP = {
  USER_CREATED: 'USER',
  USER_UPDATED_BY_ADMIN: 'USER',
  USER_DELETED_BY_ADMIN: 'USER',
  USER_PROFILE_VIEWED: 'USER',
  PROFILE_UPDATED: 'USER',
  PASSWORD_CHANGED: 'AUTH',
  PASSWORD_RESET: 'AUTH',
  PASSWORD_CHANGED_BY_ADMIN: 'AUTH',
  LOGIN_SUCCESS: 'AUTH',
  LOGIN_FAILED: 'AUTH',
  LOGOUT: 'AUTH',
  ACCOUNT_OPENED: 'ACCOUNT',
  KYC_APPROVED: 'KYC',
  KYC_REJECTED: 'KYC',
  KYC_SUBMITTED: 'KYC',
  DEPOSIT_APPROVED: 'DEPOSIT',
  DEPOSIT_REJECTED: 'DEPOSIT',
  DEPOSIT_CREATED_BY_ADMIN: 'DEPOSIT',
  DEPOSIT_AMOUNT_EDITED: 'DEPOSIT',
  DEPOSIT_REQUESTED: 'DEPOSIT',
  WITHDRAWAL_APPROVED: 'WITHDRAWAL',
  WITHDRAWAL_REJECTED: 'WITHDRAWAL',
  WITHDRAWAL_CREATED_BY_ADMIN: 'WITHDRAWAL',
  WITHDRAWAL_REQUESTED: 'WITHDRAWAL',
  TRANSFER_COMPLETED: 'TRANSFER',
  TRADE_OPENED_BY_ADMIN: 'TRADE',
  TRADE_CLOSED_BY_ADMIN: 'TRADE',
  TRADE_MODIFIED_BY_ADMIN: 'TRADE',
  TRADE_CLOSED_EDITED_BY_ADMIN: 'TRADE',
  TRADE_DELETED_BY_ADMIN: 'TRADE',
  TRADE_RESTORED_BY_ADMIN: 'TRADE',
  INQUIRY_SUBMITTED: 'INQUIRY',
  INQUIRY_REVIEWED: 'INQUIRY',
  INQUIRY_CLOSED: 'INQUIRY',
  NOTIFICATION_BROADCAST: 'NOTIFICATION',
  NOTIFICATION_SENT: 'NOTIFICATION',
  ADMIN_CREATED: 'ADMIN',
  ADMIN_UPDATED: 'ADMIN',
  ADMIN_DELETED: 'ADMIN',
  PLAN_CREATED: 'SETTINGS',
  PLAN_UPDATED: 'SETTINGS',
  PLAN_DELETED: 'SETTINGS',
  INSTRUMENT_CREATED: 'SETTINGS',
  INSTRUMENT_UPDATED: 'SETTINGS',
  INSTRUMENT_DELETED: 'SETTINGS',
  PAYMENT_METHOD_CREATED: 'SETTINGS',
  PAYMENT_METHOD_UPDATED: 'SETTINGS',
  PAYMENT_METHOD_STATUS_CHANGED: 'SETTINGS',
  PAYMENT_METHOD_DELETED: 'SETTINGS',
  HOLIDAY_CREATED: 'SETTINGS',
  HOLIDAY_UPDATED: 'SETTINGS',
  HOLIDAY_DELETED: 'SETTINGS',
  CONVERSION_RATES_UPDATED: 'SETTINGS',
  WITHDRAW_METHODS_UPDATED: 'SETTINGS',
  BONUS_SETTINGS_UPDATED: 'SETTINGS',
  BONUS_CREDITED: 'SETTINGS',
  TRADABLE_FUND_CREDITED: 'SETTINGS',
  WALLET_ADJUSTED: 'SETTINGS',
  IB_LEVELS_UPDATED: 'SETTINGS',
  IB_DASHBOARD_UPDATED: 'SETTINGS',
  BROKER_RISK_UPDATED: 'SETTINGS',
  SLIPPAGE_UPDATED: 'SETTINGS',
  PLAN_SPREAD_UPDATED: 'SETTINGS',
  SYMBOLS_BULK_ADDED: 'SETTINGS'
};

export function getActionCategory(action) {
  return ACTION_CATEGORY_MAP[action] || 'SYSTEM';
}

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

  const cond =
    cursor.type === 'date'
      ? { createdAt: { $lt: cursor.date } }
      : {
          $or: [
            { createdAt: { $lt: cursor.date } },
            { createdAt: cursor.date, _id: { $lt: cursor.id } }
          ]
        };

  // Merge with an existing createdAt range (from/to filters) instead of
  // overwriting it — Mongo allows only one createdAt key per filter level.
  if (filter.createdAt) {
    const range = { createdAt: filter.createdAt };
    delete filter.createdAt;
    filter.$and = (filter.$and || []).concat([range, cond]);
    return;
  }

  Object.assign(filter, cond);
}

function actorRoleOf(user) {
  if (!user) return null;
  if (user.userType === 'ADMIN') {
    return user.platformRole || 'ADMIN';
  }
  return user.userType || null;
}

/**
 * Record an activity log entry.
 * Snapshots target user + actor identity so logs stay readable
 * even if accounts are later deleted.
 */
export async function recordActivity({
  userId,
  action,
  actorId = null,
  actorType = ACTOR_TYPES.SYSTEM,
  ip = null,
  userAgent = null,
  category = null,
  description = null,
  targetEntityType = null,
  targetEntityId = null,
  metadata = null,
  status = 'SUCCESS'
}) {
  if (!mongoose.isValidObjectId(userId)) return null;
  if (!action) return null;

  const payload = {
    user_id: userId,
    action,
    category: category || getActionCategory(action),
    actor_type: actorType,
    status: status === 'FAILED' ? 'FAILED' : 'SUCCESS',
    ip: ip ? String(ip).slice(0, 64) : null,
    user_agent: userAgent ? String(userAgent).slice(0, 300) : null,
    description: description ? String(description).slice(0, 500) : null
  };

  if (actorId && mongoose.isValidObjectId(actorId)) {
    payload.actor_id = actorId;
  }
  if (targetEntityType) payload.target_entity_type = String(targetEntityType).slice(0, 60);
  if (targetEntityId && mongoose.isValidObjectId(targetEntityId)) {
    payload.target_entity_id = targetEntityId;
  }
  if (metadata && typeof metadata === 'object') {
    try {
      payload.metadata = JSON.parse(JSON.stringify(metadata));
    } catch {
      payload.metadata = null;
    }
  }

  // Snapshot identities (target user + actor) in one query.
  try {
    const ids = [userId];
    if (payload.actor_id) ids.push(payload.actor_id);
    const users = await User.find({ _id: { $in: ids } })
      .select('name email userType platformRole')
      .lean();

    const target = users.find((u) => String(u._id) === String(userId));
    if (target) {
      payload.user_name = target.name || null;
      payload.user_email = target.email || null;
    }

    if (payload.actor_id) {
      const actor = users.find((u) => String(u._id) === String(payload.actor_id));
      if (actor) {
        payload.actor_name = actor.name || null;
        payload.actor_email = actor.email || null;
        payload.actor_role = actorRoleOf(actor);
      }
    }
  } catch {
    /* non-fatal */
  }

  return ActivityLog.create(payload);
}

/**
 * Log an admin-performed action.
 * userId = affected user; falls back to the admin's own id for
 * broker-level settings changes (plans, instruments, rates, etc.).
 */
export async function logAdminAction({
  actorId,
  userId = null,
  action,
  ip = null,
  userAgent = null,
  category = null,
  description = null,
  targetEntityType = null,
  targetEntityId = null,
  metadata = null
}) {
  const targetUserId = userId || actorId;
  if (!targetUserId || !mongoose.isValidObjectId(targetUserId)) return null;
  if (!actorId || !mongoose.isValidObjectId(actorId)) return null;

  return recordActivity({
    userId: targetUserId,
    action,
    actorId,
    actorType: ACTOR_TYPES.ADMIN,
    ip,
    userAgent,
    category,
    description,
    targetEntityType,
    targetEntityId,
    metadata
  });
}

const LIST_SELECT =
  '_id user_id action category description actor_type actor_id actor_name actor_email actor_role ' +
  'target_entity_type target_entity_id metadata status ip user_agent user_name user_email createdAt';

function mapPopulatedItem(item) {
  const user =
    item.user_id && typeof item.user_id === 'object' ? item.user_id : null;
  const actor =
    item.actor_id && typeof item.actor_id === 'object' ? item.actor_id : null;

  return {
    ...item,
    user_id: user?._id ?? item.user_id,
    user_name: user?.name ?? item.user_name ?? null,
    user_email: user?.email ?? item.user_email ?? null,
    actor_id: actor?._id ?? item.actor_id,
    actor_name: actor?.name ?? item.actor_name ?? null,
    actor_email: actor?.email ?? item.actor_email ?? null,
    actor_role: item.actor_role || (actor ? actorRoleOf(actor) : null)
  };
}

function paginateDocs(docs, safeLimit, includeUser) {
  const hasMore = docs.length > safeLimit;
  const rawItems = hasMore ? docs.slice(0, safeLimit) : docs;
  const items = includeUser ? rawItems.map(mapPopulatedItem) : rawItems;
  const lastItem = items[items.length - 1];
  const nextCursor =
    hasMore && lastItem
      ? `${lastItem.createdAt.toISOString()}|${String(lastItem._id)}`
      : null;

  return { items, nextCursor, limit: safeLimit };
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
    .select(LIST_SELECT)
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1);

  if (includeUser) {
    query = query
      .populate('user_id', 'name email')
      .populate('actor_id', 'name email userType platformRole');
  }

  const docs = await query.lean();
  return paginateDocs(docs, safeLimit, includeUser);
}

export async function getAllActivityService({
  limit = 20,
  before = null,
  action = null,
  userId = null,
  actorType = null,
  category = null,
  status = null,
  from = null,
  to = null,
  includeUser = false,
  brokerId = null,
}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);

  const filter = {};

  if (action && typeof action === 'string') {
    filter.action = action.trim().toUpperCase();
  }

  if (category && typeof category === 'string') {
    const cat = category.trim().toUpperCase();
    if (ACTIVITY_CATEGORIES.includes(cat)) {
      filter.category = cat;
    }
  }

  if (status && typeof status === 'string') {
    const st = status.trim().toUpperCase();
    if (st === 'SUCCESS' || st === 'FAILED') {
      filter.status = st;
    }
  }

  if (actorType && typeof actorType === 'string') {
    filter.actor_type = actorType.trim().toUpperCase();
  }

  // Date range filter (createdAt)
  const fromDate = from ? new Date(from) : null;
  const toDate = to ? new Date(to) : null;
  const fromValid = fromDate && !Number.isNaN(fromDate.getTime());
  const toValid = toDate && !Number.isNaN(toDate.getTime());
  if (fromValid || toValid) {
    filter.createdAt = {};
    if (fromValid) filter.createdAt.$gte = fromDate;
    if (toValid) {
      // include the whole "to" day when only a date is given
      const end = new Date(toDate);
      if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
        end.setHours(23, 59, 59, 999);
      }
      filter.createdAt.$lte = end;
    }
  }

  if (userId) {
    if (!mongoose.isValidObjectId(userId)) {
      throw new Error('Invalid userId');
    }
    filter.user_id = userId;
  } else if (brokerId) {
    const { getBrokerUserIds } = await import('../utils/brokerScope.js');
    const ids = await getBrokerUserIds(brokerId);
    const idList = ids || [];
    // Show logs for broker users AND logs performed BY broker admins/sub-admins
    // (covers admin actions on users whose brokerId stamp is missing).
    filter.$and = [
      {
        $or: [
          { user_id: { $in: idList } },
          { actor_id: { $in: idList } }
        ]
      }
    ];
  }

  applyCursorFilter(filter, before);

  let query = ActivityLog.find(filter)
    .select(LIST_SELECT)
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1);

  if (includeUser) {
    query = query
      .populate('user_id', 'name email')
      .populate('actor_id', 'name email userType platformRole');
  }

  const docs = await query.lean();
  return paginateDocs(docs, safeLimit, includeUser);
}
