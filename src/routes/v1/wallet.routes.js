import express from "express";
import {
  getWalletController,
  listWalletTransactionsController,
  transferWalletController,
  requestWalletWithdrawalController,
  listUserWalletWithdrawalsController,
  adminAdjustWalletController,
} from "../../controllers/wallet.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";

const router = express.Router();

// User wallet routes
router.get("/", authMiddleware, getWalletController);
router.get("/transactions", authMiddleware, listWalletTransactionsController);
router.post("/transfer", authMiddleware, transferWalletController);
router.post("/withdraw", authMiddleware, requestWalletWithdrawalController);
router.get("/withdrawals", authMiddleware, listUserWalletWithdrawalsController);

// Admin: adjust a user's wallet balance
router.post("/admin/adjust", brokerAdminAuth, adminAdjustWalletController);

export default router;
