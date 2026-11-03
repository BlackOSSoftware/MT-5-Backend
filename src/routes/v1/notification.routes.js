import express from 'express';
import {
  adminBroadcastNotification,
  adminSendUserNotification,
  adminListNotifications,
  adminGetInbox,
  adminGetInboxCount,
  adminMarkInboxRead,
  adminMarkAllInboxRead,
  getMyNotifications,
  getMyInbox,
  getMyInboxCount,
  markMyInboxRead,
  markAllMyInboxRead,
} from '../../controllers/notification.controller.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/admin/broadcast', brokerAdminAuth, adminBroadcastNotification);
router.post('/admin/send-user', brokerAdminAuth, adminSendUserNotification);
router.get('/admin/list', brokerAdminAuth, adminListNotifications);
router.get('/admin/inbox', brokerAdminAuth, adminGetInbox);
router.get('/admin/inbox/count', brokerAdminAuth, adminGetInboxCount);
router.post('/admin/inbox/read-all', brokerAdminAuth, adminMarkAllInboxRead);
router.post('/admin/inbox/:id/read', brokerAdminAuth, adminMarkInboxRead);

// Portal / Oceana app inbox (unread; read items disappear)
router.get('/inbox', authMiddleware, getMyInbox);
router.get('/inbox/count', authMiddleware, getMyInboxCount);
router.post('/inbox/read-all', authMiddleware, markAllMyInboxRead);
router.post('/inbox/:id/read', authMiddleware, markMyInboxRead);

router.get('/', authMiddleware, getMyNotifications);

export default router;
