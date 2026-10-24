import { Router } from 'express';
import { adminDeleteUser, adminGetUserProfile, adminListUsers, adminSearchUsers, adminUpdateUser, getMyProfile, saveFcmToken, heartbeatPresence, markPresenceOffline, updateMyProfile } from '../../controllers/user.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { adminAuth } from '../../middlewares/adminAuth.middleware.js';
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
router.get('/admin/search', authMiddleware, adminAuth, adminSearchUsers);
router.get('/admin/list', authMiddleware, adminAuth, adminListUsers);
router.get('/admin/:userId', authMiddleware, adminAuth, adminGetUserProfile);
router.patch('/admin/:userId', authMiddleware, adminAuth, adminUpdateUser);
router.delete('/admin/:userId', authMiddleware, adminAuth, adminDeleteUser);
export default router;
