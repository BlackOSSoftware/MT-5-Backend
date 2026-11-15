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
import { brokerAdminAuth, requireBrokerPermission, requireBrokerAnyPermission } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/* USER */
router.post('/', authMiddleware, createDeposit);
router.get('/my',authMiddleware , getMyDeposits);
router.get('/:id/status', authMiddleware, getDepositStatus);

/* ADMIN */
const depositRead = requireBrokerAnyPermission(
  'finance.deposit.read',
  'finance.deposit.approve',
  'finance.deposit.reject',
);

router.post('/admin-deposit', brokerAdminAuth, requireBrokerPermission('finance.deposit.approve'), adminCreateDeposit);
router.get('/all', brokerAdminAuth, depositRead, adminGetAllDeposits);
router.get('/admin/search', brokerAdminAuth, depositRead, adminSearchDeposits);
router.patch('/:id/approve', brokerAdminAuth, requireBrokerPermission('finance.deposit.approve'), adminApproveDeposit);
router.patch('/:id/reject', brokerAdminAuth, requireBrokerPermission('finance.deposit.reject'), adminRejectDeposit);
router.patch('/:id/edit-amount', brokerAdminAuth, requireBrokerPermission('finance.deposit.approve'), adminEditDepositAmount);
export default router;
