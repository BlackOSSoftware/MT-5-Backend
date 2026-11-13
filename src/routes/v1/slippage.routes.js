import express from "express";
import {
  brokerAdminAuth,
  requireBrokerPermission,
} from "../../middlewares/brokerAuth.middleware.js";
import {
  adminGetSlippageSettings,
  adminUpdateSlippageSettings,
} from "../../controllers/slippage.controller.js";

const router = express.Router();

// Admin slippage execution settings (global singleton)
// View: any broker admin. Modify: requires settings.slippage permission
// (SuperAdmin always allowed via requireBrokerPermission).
router.get("/settings", brokerAdminAuth, adminGetSlippageSettings);
router.put(
  "/settings",
  brokerAdminAuth,
  requireBrokerPermission("settings.slippage"),
  adminUpdateSlippageSettings,
);

export default router;
