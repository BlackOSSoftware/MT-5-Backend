import {
  broadcastNotification,
  getUserNotificationsService,
  sendAdminUserNotification,
  listAdminNotificationsService,
  getAdminInboxService,
  getAdminUnreadCountService,
  markAdminNotificationReadService,
  markAllAdminNotificationsReadService,
  getUserInboxService,
  getUserUnreadCountService,
  markUserNotificationReadService,
  markAllUserNotificationsReadService,
} from '../services/notification.service.js';

const adminScope = (req) => ({
  brokerId: req.brokerId || null,
  isSuperAdmin: req.isSuperAdmin === true,
});

export async function adminBroadcastNotification(req, res) {
  try {
    const { title, message, data, expireAt } = req.body;

    if (!title || !message || !expireAt) {
      return res.status(400).json({
        success: false,
        message: 'title, message and expireAt are required',
      });
    }

    const expiryDate = new Date(expireAt);

    if (Number.isNaN(expiryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expireAt date',
      });
    }

    if (expiryDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'expireAt must be a future date',
      });
    }

    // SuperAdmin chooses the audience and (without x-broker-id) reaches every broker.
    // Broker admins always notify their own broker's clients only.
    const isSuperAdmin = req.isSuperAdmin === true;
    const requested = String(req.body.audience || 'USERS').trim().toUpperCase();
    const audience = isSuperAdmin && requested === 'ADMINS' ? 'ADMINS' : 'USERS';
    if (!isSuperAdmin && !req.brokerId) {
      return res.status(403).json({ success: false, message: 'Broker scope required' });
    }

    const result = await broadcastNotification({
      title,
      message,
      data,
      expireAt: expiryDate,
      brokerId: req.brokerId || null,
      audience,
      sentBy: req.user?._id || null,
    });

    return res.json({
      success: true,
      message: audience === 'ADMINS' ? 'Notification sent to admins' : 'Notification sent to users',
      result,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function adminSendUserNotification(req, res) {
  try {
    const { title, message, data, expireAt, userId, email } = req.body;

    if (!title || !message || !expireAt) {
      return res.status(400).json({
        success: false,
        message: 'title, message and expireAt are required',
      });
    }
    if (!userId && !email) {
      return res.status(400).json({
        success: false,
        message: 'userId or email is required',
      });
    }

    const result = await sendAdminUserNotification({
      userId,
      email,
      title,
      message,
      data,
      expireAt,
      brokerId: req.brokerId || null,
      sentBy: req.user?._id || null,
    });

    return res.json({
      success: true,
      message: `Notification sent to ${result.user.email}`,
      result,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function adminListNotifications(req, res) {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const q = String(req.query.q || '');
    const data = await listAdminNotificationsService({ page, limit, q, brokerId: req.brokerId || null });
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function adminGetInbox(req, res) {
  try {
    const limit = Number(req.query.limit) || 30;
    const data = await getAdminInboxService(req.user._id, { limit, scope: adminScope(req) });
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function adminGetInboxCount(req, res) {
  try {
    const unreadCount = await getAdminUnreadCountService(req.user._id, adminScope(req));
    return res.json({ success: true, unreadCount });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function adminMarkInboxRead(req, res) {
  try {
    const { id } = req.params;
    const data = await markAdminNotificationReadService(req.user._id, id);
    const unreadCount = await getAdminUnreadCountService(req.user._id, adminScope(req));
    return res.json({ success: true, ...data, unreadCount });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function adminMarkAllInboxRead(req, res) {
  try {
    const data = await markAllAdminNotificationsReadService(req.user._id, adminScope(req));
    return res.json({ success: true, ...data, unreadCount: 0 });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getMyNotifications(req, res) {
  try {
    const userId = req.user._id;
    const limit = Number(req.query.limit) || 20;
    const page = Number(req.query.page) || 1;

    const notifications = await getUserNotificationsService(
      userId,
      limit,
      page
    );

    return res.json({
      success: true,
      data: notifications,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getMyInbox(req, res) {
  try {
    const data = await getUserInboxService(req.user._id, {
      limit: Number(req.query.limit) || 40,
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function getMyInboxCount(req, res) {
  try {
    const unreadCount = await getUserUnreadCountService(req.user._id);
    return res.json({ success: true, unreadCount });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function markMyInboxRead(req, res) {
  try {
    await markUserNotificationReadService(req.user._id, req.params.id);
    const unreadCount = await getUserUnreadCountService(req.user._id);
    return res.json({ success: true, read: true, unreadCount });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function markAllMyInboxRead(req, res) {
  try {
    const data = await markAllUserNotificationsReadService(req.user._id);
    return res.json({ success: true, ...data, unreadCount: 0 });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}
