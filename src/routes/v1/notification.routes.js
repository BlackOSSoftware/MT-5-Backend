import express from 'express';
import { adminBroadcastNotification } from '../../controllers/notification.controller.js';
import { getMyNotifications } from '../../controllers/notification.controller.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
const router = express.Router();

router.post('/admin/broadcast', brokerAdminAuth, adminBroadcastNotification);
router.get('/', authMiddleware, getMyNotifications);
export default router;
