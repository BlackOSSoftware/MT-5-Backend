import express from "express";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import {
  getIbLevelSettingsController,
  upsertIbLevelSettingsController,
} from "../../controllers/ibLevelSettings.controller.js";
import {
  listIbCommissionsAdminController,
  listMyIbCommissionsController,
} from "../../controllers/ibCommission.controller.js";

const router = express.Router();

/* Admin IB level % settings */
router.get("/levels", brokerAdminAuth, getIbLevelSettingsController);
router.put("/levels", brokerAdminAuth, upsertIbLevelSettingsController);

/* Admin IB commission report */
router.get(
  "/commissions",
  brokerAdminAuth,
  listIbCommissionsAdminController,
);

/* IB portal — own commission list (spread-share) */
router.get(
  "/my-commissions",
  authMiddleware,
  listMyIbCommissionsController,
);

export default router;
