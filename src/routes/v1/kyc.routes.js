import express from 'express';
import {
  submitKyc,
  getMyKyc,
  getAllKycs,
  updateKycStatus
} from '../../controllers/kyc.controller.js';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/* USER */
router.post('/', authMiddleware, submitKyc);
router.get('/me', authMiddleware, getMyKyc);

/* ADMIN */
router.get('/admin', brokerAdminAuth, getAllKycs);
router.put('/admin/:kycId/status', brokerAdminAuth, updateKycStatus);

export default router;
