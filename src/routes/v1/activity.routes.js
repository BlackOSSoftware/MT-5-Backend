import express from 'express';
import {
  adminListActivity,
  adminGetUserActivity,
  getMyActivity
} from '../../controllers/activity.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

// GET /api/v1/activity?limit=20&before=ISO_DATE
router.get('/', authMiddleware, getMyActivity);

// GET /api/v1/activity/admin?limit=20&before=ISO_DATE&action=...&userId=...&actorType=...
router.get('/admin', brokerAdminAuth, adminListActivity);

// GET /api/v1/activity/admin/:userId?limit=20&before=ISO_DATE
router.get('/admin/:userId', brokerAdminAuth, adminGetUserActivity);

export default router;
