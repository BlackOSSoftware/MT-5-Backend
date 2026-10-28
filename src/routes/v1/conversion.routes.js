import express from "express";
import {
  convertAmount,
  getConversionRates,
  upsertConversionRates,
} from "../../controllers/conversion.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";

const router = express.Router();

// user — rates from the user's broker
router.get("/rates", authMiddleware, getConversionRates);
router.post("/convert", authMiddleware, convertAmount);

// admin — rates scoped by x-broker-id / membership
router.get("/admin/rates", brokerAdminAuth, getConversionRates);
router.put("/admin/rates", brokerAdminAuth, upsertConversionRates);

export default router;
