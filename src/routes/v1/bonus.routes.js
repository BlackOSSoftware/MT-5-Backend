import express from "express";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";
import {
  adminGetBonusSettings,
  adminUpdateBonusSettings,
  adminCreditBonus,
  adminCreditTradableFund,
} from "../../controllers/bonus.controller.js";

const router = express.Router();

// Admin settings
router.get("/settings", brokerAdminAuth, adminGetBonusSettings);
router.put("/settings", brokerAdminAuth, adminUpdateBonusSettings);

// Admin manual credit
router.post("/admin/credit", brokerAdminAuth, adminCreditBonus);
router.post("/admin/add-bonus", brokerAdminAuth, adminCreditBonus);
router.post(
  "/admin/add-tradable-fund",
  brokerAdminAuth,
  adminCreditTradableFund,
);

export default router;
