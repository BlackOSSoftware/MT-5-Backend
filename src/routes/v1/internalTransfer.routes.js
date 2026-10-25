import express from 'express';
import {
  createInternalTransferController,
  adminCreateInternalTransferController,
  getUserInternalTransfersController
} from '../../controllers/internalTransfer.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/**
 * POST /api/v1/internal-transfer
 * body: { fromAccount, toAccount, amount }
 */
router.post('/', authMiddleware, createInternalTransferController);

/**
 * POST /api/v1/internal-transfer/admin/create
 * body: { fromAccount, toAccount, amount }
 */
router.post('/admin/create', brokerAdminAuth, adminCreateInternalTransferController);

/**
 * GET /api/v1/internal-transfer?page=1&limit=10
 */
router.get('/', authMiddleware, getUserInternalTransfersController);

export default router;
