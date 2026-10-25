import { broadcastNotification } from '../services/notification.service.js';
import { getUserNotificationsService } from '../services/notification.service.js';
export async function adminBroadcastNotification(req, res) {
  try {
    const { title, message, data, expireAt } = req.body;

    // 1 Basic validation
    if (!title || !message || !expireAt) {
      return res.status(400).json({
        success: false,
        message: 'title, message and expireAt are required'
      });
    }

    const expiryDate = new Date(expireAt);

    if (Number.isNaN(expiryDate.getTime())) {
      return res.status(400).json({
        success: false,
        message: 'Invalid expireAt date'
      });
    }

    if (expiryDate <= new Date()) {
      return res.status(400).json({
        success: false,
        message: 'expireAt must be a future date'
      });
    }

    // 2 Broadcast + DB save (broker-scoped when broker admin)
    const result = await broadcastNotification({
      title,
      message,
      data,
      expireAt: expiryDate,
      brokerId: req.brokerId || null,
    });

    return res.json({
      success: true,
      message: 'Notification sent to all users',
      result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
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
      data: notifications
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}