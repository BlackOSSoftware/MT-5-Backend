import express from 'express';
import {
  adminListActivity,
  adminGetUserActivity,
  getMyActivity
} from '../../controllers/activity.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth, requireBrokerPermission } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

// GET /api/v1/activity?limit=20&before=ISO_DATE
router.get('/', authMiddleware, getMyActivity);

// GET /api/v1/activity/admin?limit=20&before=ISO_DATE&action=...&userId=...&actorType=...
router.get('/admin', brokerAdminAuth, requireBrokerPermission('activity.read'), adminListActivity);

// GET /api/v1/activity/admin/:userId?limit=20&before=ISO_DATE
router.get('/admin/:userId', brokerAdminAuth, requireBrokerPermission('activity.read'), adminGetUserActivity);

export default router;
