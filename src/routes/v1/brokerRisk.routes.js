import { Router } from "express";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";
import {
  getAdminBrokerRiskSettings,
  upsertAdminBrokerRiskSettings,
} from "../../controllers/brokerRisk.controller.js";

const router = Router();

/** GET/PUT /api/v1/risk-settings/admin — per-broker stop-out & warning % */
router.get("/admin", brokerAdminAuth, getAdminBrokerRiskSettings);
router.put("/admin", brokerAdminAuth, upsertAdminBrokerRiskSettings);

export default router;