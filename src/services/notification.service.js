// services/notification.service.js
import mongoose from 'mongoose';
import admin, { getAppMessaging } from '../config/firebase.js';
import UserDevice from '../models/UserDevice.model.js';
import PublicNotification from '../models/PublicNotification.model.js';
import AdminNotificationRead from '../models/AdminNotificationRead.model.js';
import UserNotificationRead from '../models/UserNotificationRead.model.js';
import AccountAuth from '../models/AccountAuth.model.js';
import User from '../models/User.model.js';
import BrokerMembership from '../models/BrokerMembership.model.js';
import { MEMBERSHIP_STATUS } from '../constants/brokerPermissions.js';

export const NOTIFICATION_AUDIENCES = ['USERS', 'ADMINS'];

/** FCM multicast accepts at most 500 tokens per call. */
const FCM_BATCH_SIZE = 500;

const stringifyData = (data) =>
  Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v ?? '')]));

/**
 * Recipient user ids for a broadcast.
 * USERS  → client users (of the broker when scoped, else every broker).
 * ADMINS → admin logins (broker members of the broker when scoped, else all admins).
 */
async function resolveBroadcastUserIds({ audience, brokerId }) {
  if (audience === 'ADMINS') {
    const memberships = await BrokerMembership.find({
      status: MEMBERSHIP_STATUS.ACTIVE,
      ...(brokerId ? { brokerId } : {}),
    })
      .select('userId')
      .lean();
    const legacyAdmins = await User.find({
      userType: 'ADMIN',
      ...(brokerId ? { brokerId } : {}),
    })
      .select('_id')
      .lean();
    return [
      ...new Set([...memberships.map((m) => String(m.userId)), ...legacyAdmins.map((u) => String(u._id))]),
    ];
  }

  const users = await User.find({
    userType: { $ne: 'ADMIN' },
    ...(brokerId ? { brokerId } : {}),
  })
    .select('_id')
    .lean();
  return users.map((u) => String(u._id));
}

/** Portal / Oceana app device tokens + trade-session tokens for these users. */
async function tokensForUsers(userIds) {
  if (!userIds.length) return [];
  const ids = userIds.filter((id) => mongoose.isValidObjectId(id));
  const [devices, accounts] = await Promise.all([
    UserDevice.find(
      { user_id: { $in: ids }, fcm_token: { $exists: true, $ne: '' } },
      { fcm_token: 1, _id: 0 },
    ).lean(),
    AccountAuth.find(
      { user_id: { $in: ids }, fcm_token: { $exists: true, $ne: '' } },
      { fcm_token: 1, _id: 0 },
    ).lean(),
  ]);
  return [...new Set([...devices, ...accounts].map((d) => d.fcm_token).filter(Boolean))];
}

/** Dry run: how many people / devices a broadcast would reach (no DB write, no push). */
export async function previewBroadcastRecipients({ audience = 'USERS', brokerId = null } = {}) {
  const userIds = await resolveBroadcastUserIds({ audience, brokerId });
  const tokens = await tokensForUsers(userIds);
  return { recipients: userIds.length, devices: tokens.length };
}

/** Token belongs to another Firebase project (e.g. the mobile app's). */
const MISMATCH_CODES = new Set(['messaging/mismatched-credential', 'messaging/sender-id-mismatch']);
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

async function sendBatches(messaging, tokens, { title, message, data }) {
  let successCount = 0;
  const failures = [];
  for (let i = 0; i < tokens.length; i += FCM_BATCH_SIZE) {
    const batch = tokens.slice(i, i + FCM_BATCH_SIZE);
    const response = await messaging.sendEachForMulticast({
      tokens: batch,
      notification: { title, body: message },
      data: { title: String(title), body: String(message), ...stringifyData(data) },
      android: {
        priority: 'high',
        // Must match Oceana app channel (MainActivity + flutter_local_notifications)
        notification: { channelId: 'oceana_default', sound: 'default' },
      },
      webpush: { headers: { Urgency: 'high' } },
    });
    successCount += response.successCount;
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        failures.push({ token: batch[idx], error: resp.error?.code || resp.error?.message || 'unknown' });
      }
    });
  }
  return { successCount, failures };
}

/**
 * Push to web + app tokens. Tokens from the mobile app's Firebase project fail on the
 * primary project with "mismatched-credential" and are retried with the app project.
 */
async function pushToTokens(tokens, payload) {
  const primary = await sendBatches(admin.messaging(), tokens, payload);
  let successCount = primary.successCount;
  let failures = primary.failures;

  const appMessaging = getAppMessaging();
  const mismatched = failures.filter((f) => MISMATCH_CODES.has(f.error)).map((f) => f.token);
  if (appMessaging && mismatched.length) {
    const retry = await sendBatches(appMessaging, mismatched, payload);
    successCount += retry.successCount;
    failures = [...failures.filter((f) => !MISMATCH_CODES.has(f.error)), ...retry.failures];
  }

  for (const f of failures) {
    if (!DEAD_TOKEN_CODES.has(f.error)) continue;
    UserDevice.deleteOne({ fcm_token: f.token }).catch((err) => {
      console.error('Failed to delete invalid token', f.token, err);
    });
  }

  return { successCount, failureCount: failures.length, failedTokens: failures };
}

/**
 * Broadcast notification (saved for the inbox + pushed to web / Android / iOS).
 * brokerId null = platform-wide (SuperAdmin only); set = only that broker's recipients.
 */
export async function broadcastNotification({
  title,
  message,
  data,
  expireAt,
  brokerId = null,
  audience = 'USERS',
  sentBy = null,
}) {
  if (!title || !message || !expireAt) {
    throw new Error('title, message and expireAt are required');
  }
  if (!NOTIFICATION_AUDIENCES.includes(audience)) throw new Error('Invalid audience');

  const expiryDate = new Date(expireAt);
  if (Number.isNaN(expiryDate.getTime())) throw new Error('Invalid expireAt date');
  if (expiryDate <= new Date()) throw new Error('expireAt must be a future date');

  await PublicNotification.create({
    title,
    message,
    data: data || {},
    user_id: null,
    brokerId: brokerId || null,
    audience,
    sentBy,
    expireAt: expiryDate,
  });

  const userIds = await resolveBroadcastUserIds({ audience, brokerId });
  const tokens = await tokensForUsers(userIds);
  if (!tokens.length) {
    return { saved: true, pushed: false, recipients: userIds.length, reason: 'No active FCM tokens' };
  }

  const push = await pushToTokens(tokens, { title, message, data });
  return { saved: true, pushed: true, recipients: userIds.length, ...push };
}


/**
 * Send to a specific user — prefers UserDevice FCM tokens (mobile/web),
 * falls back to AccountAuth.fcm_token for older trade sessions.
 */
export async function sendUserNotification({ userId, title, message, data }) {
  if (!userId || !title || !message) {
    throw new Error('userId, title and message are required');
  }

  const tokens = await tokensForUsers([String(userId)]);
  if (!tokens.length) {
    return { success: false, message: 'No active device tokens' };
  }

  const push = await pushToTokens(tokens, { title, message, data });
  return { success: true, ...push };
}

/**
 * Get user notifications (broadcasts + targeted to this user)
 */
export async function getUserNotificationsService(userId, limit = 20, page = 1) {
  if (!userId) throw new Error('User not authenticated');

  const skip = (page - 1) * limit;

  const notifications = await PublicNotification.find(await _userVisibleFilter(userId))
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return notifications;
}

/**
 * Admin: push + save for one portal user (by userId or email).
 */
export async function sendAdminUserNotification({
  userId,
  email,
  title,
  message,
  data,
  expireAt,
  brokerId = null,
  sentBy = null,
}) {
  if (!title || !message || !expireAt) {
    throw new Error('title, message and expireAt are required');
  }

  const expiryDate = new Date(expireAt);
  if (Number.isNaN(expiryDate.getTime())) throw new Error('Invalid expireAt date');
  if (expiryDate <= new Date()) throw new Error('expireAt must be a future date');

  let user = null;
  if (userId && mongoose.isValidObjectId(userId)) {
    user = await User.findById(userId).select('_id email name brokerId').lean();
  } else if (email) {
    user = await User.findOne({ email: String(email).trim().toLowerCase() })
      .select('_id email name brokerId')
      .lean();
  }
  // Broker admins can only message their own clients.
  if (!user || (brokerId && String(user.brokerId || '') !== String(brokerId))) {
    throw new Error('User not found');
  }

  const notification = await PublicNotification.create({
    title,
    message,
    data: data || {},
    user_id: user._id,
    brokerId: user.brokerId || brokerId || null,
    audience: 'USERS',
    sentBy,
    expireAt: expiryDate,
  });

  const push = await sendUserNotification({
    userId: user._id,
    title,
    message,
    data: data || {},
  });

  return {
    notification,
    user: { _id: user._id, email: user.email, name: user.name },
    push,
  };
}

/**
 * Admin manage table — all notifications (broadcast + targeted).
 */
export async function listAdminNotificationsService({
  page = 1,
  limit = 10,
  q = '',
  brokerId = null,
} = {}) {
  const skip = (Math.max(1, page) - 1) * Math.max(1, Math.min(limit, 100));
  // Broker admins only see their own broker's notifications; SuperAdmin sees all.
  const filter = brokerId ? { brokerId } : {};
  const term = String(q || '').trim();
  if (term) {
    filter.$or = [
      { title: { $regex: term, $options: 'i' } },
      { message: { $regex: term, $options: 'i' } },
    ];
  }

  const [list, totalItems] = await Promise.all([
    PublicNotification.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Math.max(1, Math.min(limit, 100)))
      .populate('user_id', 'email name')
      .lean(),
    PublicNotification.countDocuments(filter),
  ]);

  return {
    list,
    pagination: {
      page: Math.max(1, page),
      limit: Math.max(1, Math.min(limit, 100)),
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / Math.max(1, Math.min(limit, 100)))),
    },
  };
}

/**
 * Admin topbar inbox — unread only (read ones are hidden).
 */
export async function getAdminInboxService(adminId, { limit = 30, scope = {} } = {}) {
  if (!adminId) throw new Error('Admin not authenticated');

  const readRows = await AdminNotificationRead.find(
    { admin_id: adminId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);

  const filter = _adminVisibleFilter(scope, readIds);

  const [list, unreadCount] = await Promise.all([
    PublicNotification.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 50))
      .populate('user_id', 'email name')
      .lean(),
    PublicNotification.countDocuments(filter),
  ]);

  return { list, unreadCount };
}

export async function getAdminUnreadCountService(adminId, scope = {}) {
  if (!adminId) throw new Error('Admin not authenticated');
  const readRows = await AdminNotificationRead.find(
    { admin_id: adminId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);
  return PublicNotification.countDocuments(_adminVisibleFilter(scope, readIds));
}

export async function markAdminNotificationReadService(adminId, notificationId) {
  if (!adminId || !notificationId) {
    throw new Error('adminId and notificationId are required');
  }
  if (!mongoose.isValidObjectId(notificationId)) {
    throw new Error('Invalid notification id');
  }

  await AdminNotificationRead.updateOne(
    { admin_id: adminId, notification_id: notificationId },
    { $set: { readAt: new Date() } },
    { upsert: true }
  );

  return { read: true };
}

export async function markAllAdminNotificationsReadService(adminId, scope = {}) {
  if (!adminId) throw new Error('Admin not authenticated');

  const readRows = await AdminNotificationRead.find(
    { admin_id: adminId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);

  const unread = await PublicNotification.find(_adminVisibleFilter(scope, readIds))
    .select('_id')
    .lean();

  if (!unread.length) return { marked: 0 };

  await AdminNotificationRead.insertMany(
    unread.map((n) => ({
      admin_id: adminId,
      notification_id: n._id,
      readAt: new Date(),
    })),
    { ordered: false }
  ).catch(() => {});

  return { marked: unread.length };
}

/**
 * What a client sees: notifications sent to them + client broadcasts that are
 * platform-wide or from their own broker. Admin-only broadcasts are excluded.
 * (Missing brokerId / audience on legacy rows = platform-wide client broadcast.)
 */
async function _userVisibleFilter(userId, readIds = []) {
  const me = await User.findById(userId).select('brokerId').lean();
  const brokerScope = me?.brokerId ? [null, me.brokerId] : [null];
  return {
    isActive: true,
    expireAt: { $gt: new Date() },
    $or: [
      { user_id: userId },
      { user_id: null, audience: { $in: ['USERS', null] }, brokerId: { $in: brokerScope } },
    ],
    ...(readIds.length ? { _id: { $nin: readIds } } : {}),
  };
}

/**
 * What an admin sees in the topbar inbox: SuperAdmin → everything.
 * Broker admin → admin broadcasts (platform-wide or own broker) + own broker's notifications.
 */
function _adminVisibleFilter({ brokerId = null, isSuperAdmin = false } = {}, readIds = []) {
  const base = {
    isActive: true,
    expireAt: { $gt: new Date() },
    ...(readIds.length ? { _id: { $nin: readIds } } : {}),
  };
  if (isSuperAdmin && !brokerId) return base;
  if (!brokerId) return { ...base, audience: 'ADMINS', brokerId: null };
  return {
    ...base,
    $or: [{ audience: 'ADMINS', brokerId: { $in: [null, brokerId] } }, { brokerId }],
  };
}

/** App inbox — unread only (broadcast + targeted). */
export async function getUserInboxService(userId, { limit = 40 } = {}) {
  if (!userId) throw new Error('User not authenticated');

  const readRows = await UserNotificationRead.find(
    { user_id: userId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);
  const filter = await _userVisibleFilter(userId, readIds);

  const [list, unreadCount] = await Promise.all([
    PublicNotification.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Math.max(limit, 1), 50))
      .lean(),
    PublicNotification.countDocuments(filter),
  ]);

  return { list, unreadCount };
}

export async function getUserUnreadCountService(userId) {
  if (!userId) throw new Error('User not authenticated');
  const readRows = await UserNotificationRead.find(
    { user_id: userId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);
  return PublicNotification.countDocuments(await _userVisibleFilter(userId, readIds));
}

export async function markUserNotificationReadService(userId, notificationId) {
  if (!userId || !notificationId) {
    throw new Error('userId and notificationId are required');
  }
  if (!mongoose.isValidObjectId(notificationId)) {
    throw new Error('Invalid notification id');
  }

  await UserNotificationRead.updateOne(
    { user_id: userId, notification_id: notificationId },
    { $set: { readAt: new Date() } },
    { upsert: true }
  );

  return { read: true };
}

export async function markAllUserNotificationsReadService(userId) {
  if (!userId) throw new Error('User not authenticated');

  const readRows = await UserNotificationRead.find(
    { user_id: userId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);

  const unread = await PublicNotification.find(
    await _userVisibleFilter(userId, readIds)
  )
    .select('_id')
    .lean();

  if (!unread.length) return { marked: 0 };

  await UserNotificationRead.insertMany(
    unread.map((n) => ({
      user_id: userId,
      notification_id: n._id,
      readAt: new Date(),
    })),
    { ordered: false }
  ).catch(() => {});

  return { marked: unread.length };
}
