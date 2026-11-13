import express from "express";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";
import {
  listPlanSymbolSpreadsController,
  upsertPlanSymbolSpreadController,
  seedPlanSymbolSpreadsController,
} from "../../controllers/planSymbolSpread.controller.js";

const router = express.Router({ mergeParams: true });

// Mounted at /v1/account-plans/:planId/symbol-spreads
router.get("/", brokerAdminAuth, listPlanSymbolSpreadsController);
router.put("/", brokerAdminAuth, upsertPlanSymbolSpreadController);
router.post("/seed", brokerAdminAuth, seedPlanSymbolSpreadsController);

export default router;
