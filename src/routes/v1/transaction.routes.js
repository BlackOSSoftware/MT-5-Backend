import express from 'express';
import { adminGetUserTransactionHistory, adminListSwapDeductions, getUserTransactionHistory } from '../../controllers/transaction.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/**
 * GET /api/v1/transactions
 * Query:
 *  page
 *  limit
 *  accountId
 *  type
 *  status
 */
router.get('/', authMiddleware, getUserTransactionHistory);

// ADMIN: global swap deductions (today by default) with pagination + filters
router.get('/admin/swap', brokerAdminAuth, adminListSwapDeductions);
router.get('/admin/:userId', brokerAdminAuth, adminGetUserTransactionHistory);

export default router;
