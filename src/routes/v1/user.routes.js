import { Router } from 'express';
import { adminDeleteUser, adminGetUserProfile, adminListUsers, adminSearchUsers, adminUpdateUser, getMyProfile, saveFcmToken, heartbeatPresence, markPresenceOffline, updateMyProfile } from '../../controllers/user.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { adminAuth } from '../../middlewares/adminAuth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';
import { presenceAuthMiddleware } from '../../middlewares/presenceAuth.middleware.js';
const router = Router();

/**
 * GET /api/v1/user/me
 */
router.get('/me', authMiddleware, getMyProfile);
router.put('/me', authMiddleware, updateMyProfile);
router.post("/save-fcm-token", authMiddleware, saveFcmToken);
router.post('/presence/heartbeat', presenceAuthMiddleware, heartbeatPresence);
router.post('/presence/offline', presenceAuthMiddleware, markPresenceOffline);
router.get('/admin/search', brokerAdminAuth, adminSearchUsers);
router.get('/admin/list', brokerAdminAuth, adminListUsers);
router.get('/admin/:userId', brokerAdminAuth, adminGetUserProfile);
router.patch('/admin/:userId', brokerAdminAuth, adminUpdateUser);
router.delete('/admin/:userId', brokerAdminAuth, adminDeleteUser);
export default router;
