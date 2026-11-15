import { Router } from "express";
import { brokerAdminAuth, requireBrokerPermission } from "../../middlewares/brokerAuth.middleware.js";
import {
  getAdminBrokerRiskSettings,
  upsertAdminBrokerRiskSettings,
} from "../../controllers/brokerRisk.controller.js";

const router = Router();

/** GET/PUT /api/v1/risk-settings/admin — per-broker stop-out & warning % */
router.get("/admin", brokerAdminAuth, requireBrokerPermission("settings.risk"), getAdminBrokerRiskSettings);
router.put("/admin", brokerAdminAuth, requireBrokerPermission("settings.risk"), upsertAdminBrokerRiskSettings);

export default router;