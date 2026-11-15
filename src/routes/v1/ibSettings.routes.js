import express from "express";
import { brokerAdminAuth, requireBrokerPermission } from "../../middlewares/brokerAuth.middleware.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import {
  getIbLevelSettingsController,
  upsertIbLevelSettingsController,
} from "../../controllers/ibLevelSettings.controller.js";
import {
  getMyIbCommissionSummaryController,
  listIbCommissionsAdminController,
  listMyIbCommissionsController,
  withdrawMyIbCommissionController,
} from "../../controllers/ibCommission.controller.js";

const router = express.Router();

/* Admin IB level % settings */
router.get("/levels", brokerAdminAuth, requireBrokerPermission("settings.referral"), getIbLevelSettingsController);
router.put("/levels", brokerAdminAuth, requireBrokerPermission("settings.referral"), upsertIbLevelSettingsController);

/* Admin IB commission report */
router.get(
  "/commissions",
  brokerAdminAuth,
  requireBrokerPermission("settings.referral"),
  listIbCommissionsAdminController,
);

/* IB portal — own commission summary + list (spread-share) */
router.get(
  "/my-commission-summary",
  authMiddleware,
  getMyIbCommissionSummaryController,
);
router.post(
  "/my-commissions/withdraw",
  authMiddleware,
  withdrawMyIbCommissionController,
);
router.get(
  "/my-commissions",
  authMiddleware,
  listMyIbCommissionsController,
);

export default router;
