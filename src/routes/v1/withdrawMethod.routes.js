import express from "express";
import {
  getAdminWithdrawMethods,
  getUserWithdrawMethods,
  upsertAdminWithdrawMethods,
} from "../../controllers/withdrawMethod.controller.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";

const router = express.Router();

router.get("/", authMiddleware, getUserWithdrawMethods);
router.get("/admin", brokerAdminAuth, getAdminWithdrawMethods);
router.put("/admin", brokerAdminAuth, upsertAdminWithdrawMethods);

export default router;
