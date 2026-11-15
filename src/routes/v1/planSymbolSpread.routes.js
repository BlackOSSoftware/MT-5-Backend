import express from "express";
import { brokerAdminAuth, requireBrokerPermission } from "../../middlewares/brokerAuth.middleware.js";
import {
  listPlanSymbolSpreadsController,
  upsertPlanSymbolSpreadController,
  seedPlanSymbolSpreadsController,
} from "../../controllers/planSymbolSpread.controller.js";

const router = express.Router({ mergeParams: true });

// Mounted at /v1/account-plans/:planId/symbol-spreads
router.get("/", brokerAdminAuth, requireBrokerPermission("plans.manage"), listPlanSymbolSpreadsController);
router.put("/", brokerAdminAuth, requireBrokerPermission("plans.manage"), upsertPlanSymbolSpreadController);
router.post("/seed", brokerAdminAuth, requireBrokerPermission("plans.manage"), seedPlanSymbolSpreadsController);

export default router;
