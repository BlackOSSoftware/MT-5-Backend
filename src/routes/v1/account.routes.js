import express from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth, requireBrokerPermission } from "../../middlewares/brokerAuth.middleware.js";

import {
  createAccountController,
  getMyAccounts,
  getMyTodayLots,
  getMyAccountDetail,
  resetDemoAccountController,
  setAccountLeverageController,
  setPrimaryAccountController,
  adminListUserAccountsController,
  adminSearchAccountsController,
  adminUpdateAccountController,
  adminDeleteAccountController
} from "../../controllers/account.controller.js";

const router = express.Router();

router.post("/", authMiddleware, createAccountController);
router.get("/", authMiddleware, getMyAccounts);
router.get("/stats/today-lots", authMiddleware, getMyTodayLots);
router.get("/single/:id", authMiddleware, getMyAccountDetail);
router.post("/:id/reset-demo", authMiddleware, resetDemoAccountController);
router.post("/:id/set-leverage", authMiddleware, setAccountLeverageController);
router.post("/:id/set-primary", authMiddleware, setPrimaryAccountController);
router.get("/admin/user/:userId", brokerAdminAuth, requireBrokerPermission("users.read"), adminListUserAccountsController);
router.get("/admin/search", brokerAdminAuth, requireBrokerPermission("users.read"), adminSearchAccountsController);
router.patch("/admin/:accountId", brokerAdminAuth, requireBrokerPermission("users.update"), adminUpdateAccountController);
router.delete("/admin/:accountId", brokerAdminAuth, requireBrokerPermission("users.update"), adminDeleteAccountController);

export default router;
