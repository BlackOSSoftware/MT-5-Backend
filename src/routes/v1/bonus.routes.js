import express from "express";
import { brokerAdminAuth, requireBrokerPermission } from "../../middlewares/brokerAuth.middleware.js";
import {
  adminGetBonusSettings,
  adminUpdateBonusSettings,
  adminCreditBonus,
  adminCreditTradableFund,
} from "../../controllers/bonus.controller.js";

const router = express.Router();

// Admin settings
router.get("/settings", brokerAdminAuth, requireBrokerPermission("settings.bonus"), adminGetBonusSettings);
router.put("/settings", brokerAdminAuth, requireBrokerPermission("settings.bonus"), adminUpdateBonusSettings);

// Admin manual credit
router.post("/admin/credit", brokerAdminAuth, requireBrokerPermission("settings.bonus"), adminCreditBonus);
router.post("/admin/add-bonus", brokerAdminAuth, requireBrokerPermission("settings.bonus"), adminCreditBonus);
router.post(
  "/admin/add-tradable-fund",
  brokerAdminAuth,
  requireBrokerPermission("settings.bonus"),
  adminCreditTradableFund,
);

export default router;
