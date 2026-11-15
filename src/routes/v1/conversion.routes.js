import express from "express";
import {
  convertAmount,
  getConversionRates,
  upsertConversionRates,
} from "../../controllers/conversion.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth, requireBrokerPermission, requireBrokerAnyPermission } from "../../middlewares/brokerAuth.middleware.js";

const router = express.Router();

// user — rates from the user's broker
router.get("/rates", authMiddleware, getConversionRates);
router.post("/convert", authMiddleware, convertAmount);

// admin — rates scoped by x-broker-id / membership
const conversionRead = requireBrokerAnyPermission(
  "conversion.manage",
  "finance.deposit.read",
  "finance.deposit.approve",
  "finance.withdrawal.read",
  "finance.withdrawal.approve",
);

router.get("/admin/rates", brokerAdminAuth, conversionRead, getConversionRates);
router.put("/admin/rates", brokerAdminAuth, requireBrokerPermission("conversion.manage"), upsertConversionRates);

export default router;
