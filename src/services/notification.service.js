// services/notification.service.js
import mongoose from 'mongoose';
import admin, { getAppMessaging } from '../config/firebase.js';
import UserDevice from '../models/UserDevice.model.js';
import PublicNotification from '../models/PublicNotification.model.js';
import AdminNotificationRead from '../models/AdminNotificationRead.model.js';
import UserNotificationRead from '../models/UserNotificationRead.model.js';
import Account from '../models/Account.model.js';
import AccountAuth from '../models/AccountAuth.model.js';
import User from '../models/User.model.js';
import BrokerMembership from '../models/BrokerMembership.model.js';
import { MEMBERSHIP_STATUS } from '../constants/brokerPermissions.js';
import { sendNotificationMail } from '../utils/mail.util.js';

export const NOTIFICATION_AUDIENCES = ['USERS', 'ADMINS'];
/** Where to push FCM: web portal, mobile app, or both. */
export const PUSH_CHANNELS = ['WEB', 'APP', 'BOTH'];

/** FCM multicast accepts at most 500 tokens per call. */
const FCM_BATCH_SIZE = 500;

function normalizePushChannel(value) {
  const v = String(value || 'BOTH').trim().toUpperCase();
  return PUSH_CHANNELS.includes(v) ? v : 'BOTH';
}

function normalizeSendEmail(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (typeof value === 'string' && value.trim().toLowerCase() === 'true') return true;
  return false;
}

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

/**
 * Portal / Oceana app device tokens (+ trade-session tokens for APP).
 * @param {'WEB'|'APP'|'BOTH'} channel
 */
async function tokensForUsers(userIds, channel = 'BOTH') {
  if (!userIds.length) return [];
  const ids = userIds
    .filter((id) => mongoose.isValidObjectId(id))
    .map((id) => new mongoose.Types.ObjectId(String(id)));
  if (!ids.length) return [];

  const pushChannel = normalizePushChannel(channel);
  const includeWeb = pushChannel === 'WEB' || pushChannel === 'BOTH';
  const includeApp = pushChannel === 'APP' || pushChannel === 'BOTH';

  const deviceFilter = {
    user_id: { $in: ids },
    fcm_token: { $exists: true, $nin: [null, ''] },
  };
  if (includeWeb && !includeApp) {
    deviceFilter.platform = { $regex: /^web$/i };
  } else if (includeApp && !includeWeb) {
    deviceFilter.platform = { $regex: /^(android|ios|mobile)$/i };
  }

  // AccountAuth tokens come from trade/mobile sessions — only for APP/BOTH.
  let accountIds = [];
  if (includeApp) {
    const accountRows = await Account.find(
      { user_id: { $in: ids } },
      { _id: 1 },
    ).lean();
    accountIds = accountRows.map((a) => a._id);
  }

  const [devices, accounts] = await Promise.all([
    UserDevice.find(deviceFilter, { fcm_token: 1, _id: 0 }).lean(),
    includeApp && accountIds.length
      ? AccountAuth.find(
          {
            account_id: { $in: accountIds },
            fcm_token: { $exists: true, $nin: [null, ''] },
          },
          { fcm_token: 1, _id: 0 },
        ).lean()
      : Promise.resolve([]),
  ]);
  return [...new Set([...devices, ...accounts].map((d) => d.fcm_token).filter(Boolean))];
}

/** Dry run: how many people / devices a broadcast would reach (no DB write, no push). */
export async function previewBroadcastRecipients({
  audience = 'USERS',
  brokerId = null,
  pushChannel = 'BOTH',
} = {}) {
  const userIds = await resolveBroadcastUserIds({ audience, brokerId });
  const tokens = await tokensForUsers(userIds, pushChannel);
  return { recipients: userIds.length, devices: tokens.length, pushChannel: normalizePushChannel(pushChannel) };
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
  if (mismatched.length) {
    if (appMessaging) {
      const retry = await sendBatches(appMessaging, mismatched, payload);
      successCount += retry.successCount;
      failures = [...failures.filter((f) => !MISMATCH_CODES.has(f.error)), ...retry.failures];
    } else {
      console.error(
        `[FCM] ${mismatched.length} token(s) belong to another Firebase project; ` +
          'add firebase-admin-key-app.json (or FIREBASE_APP_KEY_PATH) to deliver them',
      );
    }
  }

  for (const f of failures) {
    // Dead tokens + unrecoverable project-mismatch (no secondary key) → drop.
    const drop =
      DEAD_TOKEN_CODES.has(f.error) ||
      (!appMessaging && MISMATCH_CODES.has(f.error));
    if (!drop) continue;
    UserDevice.deleteOne({ fcm_token: f.token }).catch((err) => {
      console.error('Failed to delete invalid token', f.token, err);
    });
  }

  return { successCount, failureCount: failures.length, failedTokens: failures };
}

/**
 * Email a notification to users (fire-and-forget safe).
 * Sends from the recipient broker's own SMTP so Oceanaprofx users get
 * mail from the Oceana mailbox, FPTrade users from theirs.
 */
async function emailNotificationToUsers({
  userIds,
  title,
  message,
  brokerId = null,
}) {
  try {
    const ids = (userIds || []).filter((id) => mongoose.isValidObjectId(id));
    if (!ids.length) return;

    const users = await User.find({
      _id: { $in: ids },
      email: { $exists: true, $ne: '' },
    })
      .select('email name brokerId')
      .lean();

    // Group by each user's own broker so mail goes from the right SMTP
    // (Oceanaprofx users ← Oceana mailbox, FPTrade users ← FPTrade mailbox).
    const byBroker = new Map();
    for (const u of users) {
      const key = String(u.brokerId || brokerId || '');
      if (!byBroker.has(key)) byBroker.set(key, []);
      byBroker.get(key).push(u);
    }

    const CONCURRENCY = 10;
    for (const [groupBrokerId, groupUsers] of byBroker) {
      for (let i = 0; i < groupUsers.length; i += CONCURRENCY) {
        const batch = groupUsers.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map((u) =>
            sendNotificationMail({
              email: u.email,
              name: u.name,
              title,
              message,
              brokerId: groupBrokerId || brokerId || null,
            }).catch((err) => {
              console.error(
                '[NOTIFICATION_MAIL] send failed',
                u.email,
                err?.message || err,
              );
            }),
          ),
        );
      }
    }
  } catch (err) {
    console.error('[NOTIFICATION_MAIL] batch failed', err?.message || err);
  }
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
  sendEmail = false,
  pushChannel = 'BOTH',
}) {
  if (!title || !message || !expireAt) {
    throw new Error('title, message and expireAt are required');
  }
  if (!NOTIFICATION_AUDIENCES.includes(audience)) throw new Error('Invalid audience');

  const expiryDate = new Date(expireAt);
  if (Number.isNaN(expiryDate.getTime())) throw new Error('Invalid expireAt date');
  if (expiryDate <= new Date()) throw new Error('expireAt must be a future date');

  const channel = normalizePushChannel(pushChannel);
  const wantEmail = normalizeSendEmail(sendEmail);

  await PublicNotification.create({
    title,
    message,
    data: {
      ...(data || {}),
      pushChannel: channel,
      sendEmail: wantEmail,
    },
    user_id: null,
    brokerId: brokerId || null,
    audience,
    sentBy,
    expireAt: expiryDate,
  });

  const userIds = await resolveBroadcastUserIds({ audience, brokerId });
  const tokens = await tokensForUsers(userIds, channel);

  // Email only when admin explicitly opts in.
  if (wantEmail && audience === 'USERS' && userIds.length) {
    emailNotificationToUsers({ userIds, title, message, brokerId }).catch(
      () => {},
    );
  }

  if (!tokens.length) {
    return {
      saved: true,
      pushed: false,
      recipients: userIds.length,
      pushChannel: channel,
      sendEmail: wantEmail,
      reason: `No active FCM tokens for ${channel}`,
    };
  }

  const push = await pushToTokens(tokens, { title, message, data });
  return {
    saved: true,
    pushed: true,
    recipients: userIds.length,
    pushChannel: channel,
    sendEmail: wantEmail,
    ...push,
  };
}


/**
 * Send to a specific user — prefers UserDevice FCM tokens (mobile/web),
 * falls back to AccountAuth.fcm_token for older trade sessions.
 */
export async function sendUserNotification({
  userId,
  title,
  message,
  data,
  pushChannel = 'BOTH',
}) {
  if (!userId || !title || !message) {
    throw new Error('userId, title and message are required');
  }

  const channel = normalizePushChannel(pushChannel);
  const tokens = await tokensForUsers([String(userId)], channel);
  if (!tokens.length) {
    return {
      success: false,
      message: `No active device tokens for ${channel}`,
      pushChannel: channel,
    };
  }

  const push = await pushToTokens(tokens, { title, message, data });
  return { success: true, pushChannel: channel, ...push };
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
  sendEmail = false,
  pushChannel = 'BOTH',
}) {
  if (!title || !message || !expireAt) {
    throw new Error('title, message and expireAt are required');
  }

  const expiryDate = new Date(expireAt);
  if (Number.isNaN(expiryDate.getTime())) throw new Error('Invalid expireAt date');
  if (expiryDate <= new Date()) throw new Error('expireAt must be a future date');

  const channel = normalizePushChannel(pushChannel);
  const wantEmail = normalizeSendEmail(sendEmail);

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
    data: {
      ...(data || {}),
      pushChannel: channel,
      sendEmail: wantEmail,
    },
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
    pushChannel: channel,
  });

  if (wantEmail) {
    emailNotificationToUsers({
      userIds: [user._id],
      title,
      message,
      brokerId: user.brokerId || brokerId || null,
    }).catch(() => {});
  }

  return {
    notification,
    user: { _id: user._id, email: user.email, name: user.name },
    push,
    sendEmail: wantEmail,
    pushChannel: channel,
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
