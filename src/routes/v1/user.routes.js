import { Router } from 'express';
import { adminDeleteUser, adminGetUserProfile, adminListUsers, adminSearchUsers, adminSetAppLock, adminSetIbDashboard, adminUpdateUser, getMyProfile, saveFcmToken, heartbeatPresence, markPresenceOffline, updateMyProfile } from '../../controllers/user.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { adminAuth } from '../../middlewares/adminAuth.middleware.js';
import { brokerAdminAuth, requireBrokerPermission } from '../../middlewares/brokerAuth.middleware.js';
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
router.get('/admin/search', brokerAdminAuth, requireBrokerPermission('users.read'), adminSearchUsers);
router.get('/admin/list', brokerAdminAuth, requireBrokerPermission('users.read'), adminListUsers);
router.get('/admin/:userId', brokerAdminAuth, requireBrokerPermission('users.read'), adminGetUserProfile);
router.patch('/admin/:userId/app-lock', brokerAdminAuth, requireBrokerPermission('users.update'), adminSetAppLock);
router.patch('/admin/:userId/ib-dashboard', brokerAdminAuth, requireBrokerPermission('users.update'), adminSetIbDashboard);
router.patch('/admin/:userId', brokerAdminAuth, requireBrokerPermission('users.update'), adminUpdateUser);
router.delete('/admin/:userId', brokerAdminAuth, requireBrokerPermission('users.update'), adminDeleteUser);
export default router;
