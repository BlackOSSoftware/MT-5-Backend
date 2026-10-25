import express from 'express';
import {
  createDeposit,
  getMyDeposits,
  getDepositStatus,
  adminGetAllDeposits,
  adminSearchDeposits,
  adminApproveDeposit,
  adminRejectDeposit,
  adminEditDepositAmount,
  adminCreateDeposit
} from "../../controllers/deposit.controller.js";
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { adminAuth } from '../../middlewares/adminAuth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/* USER */
router.post('/', authMiddleware, createDeposit);
router.get('/my',authMiddleware , getMyDeposits);
router.get('/:id/status', authMiddleware, getDepositStatus);

/* ADMIN */
router.post('/admin-deposit', brokerAdminAuth, adminCreateDeposit);
router.get('/all', brokerAdminAuth, adminGetAllDeposits);
router.get('/admin/search', brokerAdminAuth, adminSearchDeposits);
router.patch('/:id/approve', brokerAdminAuth, adminApproveDeposit);
router.patch('/:id/reject', brokerAdminAuth, adminRejectDeposit);
router.patch('/:id/edit-amount', brokerAdminAuth, adminEditDepositAmount);
export default router;
