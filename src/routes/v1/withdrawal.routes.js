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
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";

const router = express.Router();

/**
 * USER ROUTES
 */
router.post("/", authMiddleware, createWithdrawalRequestController);
router.get("/", authMiddleware, listUserWithdrawalsController);

/**
 * ADMIN ROUTES
 */
router.post("/admin/create", brokerAdminAuth, adminCreateWithdrawalController);
router.get("/admin/search", brokerAdminAuth, adminSearchWithdrawalsController);
router.get("/admin/all", brokerAdminAuth, listAdminWithdrawalsController);
router.patch("/admin/:withdrawalId/approve", brokerAdminAuth, adminApproveWithdrawalController);
router.patch("/admin/:withdrawalId/reject", brokerAdminAuth, adminRejectWithdrawalController);

export default router;
