// services/notification.service.js
import mongoose from 'mongoose';
import admin from '../config/firebase.js';
import UserDevice from '../models/UserDevice.model.js';
import PublicNotification from '../models/PublicNotification.model.js';
import AdminNotificationRead from '../models/AdminNotificationRead.model.js';
import UserNotificationRead from '../models/UserNotificationRead.model.js';
import AccountAuth from '../models/AccountAuth.model.js';
import User from '../models/User.model.js';
import { getBrokerUserIds } from '../utils/brokerScope.js';

/**
 * Broadcast to all devices (web + android + ios if present).
 * When brokerId is set, only devices for that broker's users are targeted.
 * PublicNotification has no brokerId field — stamp skipped.
 */
export async function broadcastNotification({
  title,
  message,
  data,
  expireAt,
  brokerId = null,
}) {
  if (!title || !message || !expireAt) {
    throw new Error('title, message and expireAt are required');
  }

  const expiryDate = new Date(expireAt);
  if (Number.isNaN(expiryDate.getTime())) throw new Error('Invalid expireAt date');
  if (expiryDate <= new Date()) throw new Error('expireAt must be a future date');

  // 1. Save in DB (broadcast — user_id null)
  const notification = await PublicNotification.create({
    title,
    message,
    data: data || {},
    user_id: null,
    expireAt: expiryDate,
  });

  // 2. Get tokens for all platforms (do NOT filter only web)
  const deviceFilter = { fcm_token: { $exists: true, $ne: '' } };
  if (brokerId) {
    const brokerUserIds = await getBrokerUserIds(brokerId);
    deviceFilter.user_id = { $in: brokerUserIds || [] };
  }

  const devices = await UserDevice.find(
    deviceFilter,
    { fcm_token: 1, platform: 1, _id: 0 }
  ).lean();

  const tokens = devices.map(d => d.fcm_token).filter(Boolean);
  if (!tokens.length) {
    return { saved: true, pushed: false, reason: 'No active FCM tokens' };
  }

  // 3. Send to Firebase (multicast)
  const payloadData = {
    title: title,
    body: message,
    ...(data || {})
  };

  const response = await admin.messaging().sendEachForMulticast({
    tokens,

    notification: {
      title: title,
      body: message
    },

    data: payloadData,

    android: {
      priority: "high",
      notification: {
        // Must match Oceana app channel (MainActivity + flutter_local_notifications)
        channelId: "oceana_default",
        sound: "default"
      }
    },

    webpush: {
      headers: {
        Urgency: "high"
      }
    }
  });

  // 4. Cleanup invalid tokens and aggregate errors
  const failedTokens = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      const errCode = resp.error?.code || resp.error?.message || 'unknown';
      const failedToken = tokens[idx];
      failedTokens.push({ token: failedToken, error: errCode });

      // Remove tokens that are definitely invalid / unregistered
      if (
        resp.error &&
        (resp.error.code === 'messaging/registration-token-not-registered' ||
          resp.error.code === 'messaging/invalid-registration-token')
      ) {
        UserDevice.deleteOne({ fcm_token: failedToken }).catch((err) => {
          console.error('Failed to delete invalid token', failedToken, err);
        });
      }
    }
  });

  return {
    saved: true,
    pushed: true,
    successCount: response.successCount,
    failureCount: response.failureCount,
    failedTokens
  };
}


/**
 * Send to a specific user — prefers UserDevice FCM tokens (mobile/web),
 * falls back to AccountAuth.fcm_token for older trade sessions.
 */
export async function sendUserNotification({ userId, title, message, data }) {
  if (!userId || !title || !message) {
    throw new Error('userId, title and message are required');
  }

  const devices = await UserDevice.find(
    { user_id: userId, fcm_token: { $exists: true, $ne: '' } },
    { fcm_token: 1, _id: 0 }
  ).lean();

  const accounts = await AccountAuth.find(
    { user_id: userId, fcm_token: { $exists: true, $ne: '' } },
    { fcm_token: 1, _id: 0 }
  ).lean();

  const tokens = [
    ...new Set(
      [
        ...devices.map((d) => d.fcm_token),
        ...accounts.map((acc) => acc.fcm_token),
      ].filter(Boolean)
    ),
  ];
  if (!tokens.length) {
    return { success: false, message: 'No active device tokens' };
  }

  const response = await admin.messaging().sendEachForMulticast({
    tokens,

    notification: {
      title: title,
      body: message,
    },

    data: {
      title: String(title),
      body: String(message),
      ...(data
        ? Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
          )
        : {}),
    },

    android: {
      priority: 'high',
      notification: {
        channelId: 'oceana_default',
        sound: 'default',
      },
    },

    webpush: {
      headers: {
        Urgency: 'high',
      },
    },
  });

  response.responses.forEach((resp, idx) => {
    if (!resp.success) {
      const failedToken = tokens[idx];
      if (
        resp.error &&
        (resp.error.code === 'messaging/registration-token-not-registered' ||
          resp.error.code === 'messaging/invalid-registration-token')
      ) {
        UserDevice.deleteOne({ fcm_token: failedToken }).catch((err) => {
          console.error('Failed to delete invalid token', failedToken, err);
        });
      }
    }
  });

  return {
    success: true,
    successCount: response.successCount,
    failureCount: response.failureCount,
    response,
  };
}

/**
 * Get user notifications (broadcasts + targeted to this user)
 */
export async function getUserNotificationsService(userId, limit = 20, page = 1) {
  if (!userId) throw new Error('User not authenticated');

  const now = new Date();
  const skip = (page - 1) * limit;

  const notifications = await PublicNotification.find({
    isActive: true,
    expireAt: { $gt: now },
    $or: [
      { user_id: userId },
      { user_id: null },
    ],
  })
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
}) {
  if (!title || !message || !expireAt) {
    throw new Error('title, message and expireAt are required');
  }

  const expiryDate = new Date(expireAt);
  if (Number.isNaN(expiryDate.getTime())) throw new Error('Invalid expireAt date');
  if (expiryDate <= new Date()) throw new Error('expireAt must be a future date');

  let user = null;
  if (userId && mongoose.isValidObjectId(userId)) {
    user = await User.findById(userId).select('_id email name').lean();
  } else if (email) {
    user = await User.findOne({ email: String(email).trim().toLowerCase() })
      .select('_id email name')
      .lean();
  }
  if (!user) throw new Error('User not found');

  const notification = await PublicNotification.create({
    title,
    message,
    data: data || {},
    user_id: user._id,
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
} = {}) {
  const skip = (Math.max(1, page) - 1) * Math.max(1, Math.min(limit, 100));
  const filter = {};
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
export async function getAdminInboxService(adminId, { limit = 30 } = {}) {
  if (!adminId) throw new Error('Admin not authenticated');

  const now = new Date();
  const readRows = await AdminNotificationRead.find(
    { admin_id: adminId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);

  const filter = {
    isActive: true,
    expireAt: { $gt: now },
    ...(readIds.length ? { _id: { $nin: readIds } } : {}),
  };

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

export async function getAdminUnreadCountService(adminId) {
  if (!adminId) throw new Error('Admin not authenticated');
  const now = new Date();
  const readRows = await AdminNotificationRead.find(
    { admin_id: adminId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);
  return PublicNotification.countDocuments({
    isActive: true,
    expireAt: { $gt: now },
    ...(readIds.length ? { _id: { $nin: readIds } } : {}),
  });
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

export async function markAllAdminNotificationsReadService(adminId) {
  if (!adminId) throw new Error('Admin not authenticated');

  const now = new Date();
  const readRows = await AdminNotificationRead.find(
    { admin_id: adminId },
    { notification_id: 1, _id: 0 }
  ).lean();
  const readIds = readRows.map((r) => r.notification_id);

  const unread = await PublicNotification.find({
    isActive: true,
    expireAt: { $gt: now },
    ...(readIds.length ? { _id: { $nin: readIds } } : {}),
  })
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

function _userVisibleFilter(userId, readIds = []) {
  const now = new Date();
  return {
    isActive: true,
    expireAt: { $gt: now },
    $or: [{ user_id: userId }, { user_id: null }],
    ...(readIds.length ? { _id: { $nin: readIds } } : {}),
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
  const filter = _userVisibleFilter(userId, readIds);

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
  return PublicNotification.countDocuments(_userVisibleFilter(userId, readIds));
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
    _userVisibleFilter(userId, readIds)
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
