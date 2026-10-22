import express from "express";
import { adminAuth } from "../../middlewares/adminAuth.middleware.js";
import {
  getUpdateInfoController,
  upsertReleaseController,
} from "./appUpdate.controller.js";

const router = express.Router();

// App (bina login) - GET /api/v1/app-update/info?platform=android
router.get("/info", getUpdateInfoController);

// Admin
router.get("/admin", adminAuth, getUpdateInfoController);
router.put("/admin", adminAuth, upsertReleaseController);

export default router;
