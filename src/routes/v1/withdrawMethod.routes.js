import express from "express";
import {
  getAdminWithdrawMethods,
  getUserWithdrawMethods,
  upsertAdminWithdrawMethods,
} from "../../controllers/withdrawMethod.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth, requireBrokerPermission } from "../../middlewares/brokerAuth.middleware.js";

const router = express.Router();

router.get("/", authMiddleware, getUserWithdrawMethods);
router.get("/admin", brokerAdminAuth, requireBrokerPermission("finance.payment_methods.manage"), getAdminWithdrawMethods);
router.put("/admin", brokerAdminAuth, requireBrokerPermission("finance.payment_methods.manage"), upsertAdminWithdrawMethods);

export default router;
