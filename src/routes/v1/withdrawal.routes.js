import express from "express";
import {
  createWithdrawalRequestController,
  listUserWithdrawalsController,
  listAdminWithdrawalsController,
  adminSearchWithdrawalsController,
  adminApproveWithdrawalController,
  adminRejectWithdrawalController,
  adminCreateWithdrawalController,
} from "../../controllers/withdrawal.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { adminAuth } from "../../middlewares/adminAuth.middleware.js";
import { brokerAdminAuth, requireBrokerPermission, requireBrokerAnyPermission } from "../../middlewares/brokerAuth.middleware.js";

const router = express.Router();

/**
 * USER ROUTES
 */
router.post("/", authMiddleware, createWithdrawalRequestController);
router.get("/", authMiddleware, listUserWithdrawalsController);

/**
 * ADMIN ROUTES
 */
const withdrawalRead = requireBrokerAnyPermission(
  "finance.withdrawal.read",
  "finance.withdrawal.approve",
  "finance.withdrawal.reject",
);

router.post("/admin/create", brokerAdminAuth, requireBrokerPermission("finance.withdrawal.approve"), adminCreateWithdrawalController);
router.get("/admin/search", brokerAdminAuth, withdrawalRead, adminSearchWithdrawalsController);
router.get("/admin/all", brokerAdminAuth, withdrawalRead, listAdminWithdrawalsController);
router.patch("/admin/:withdrawalId/approve", brokerAdminAuth, requireBrokerPermission("finance.withdrawal.approve"), adminApproveWithdrawalController);
router.patch("/admin/:withdrawalId/reject", brokerAdminAuth, requireBrokerPermission("finance.withdrawal.reject"), adminRejectWithdrawalController);

export default router;
