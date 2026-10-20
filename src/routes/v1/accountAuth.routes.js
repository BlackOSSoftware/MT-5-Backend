import express from "express";
import { accountLoginController, getAccountProfileController, resetTradePasswordController, resetWatchPasswordController, adminResetTradePasswordController, adminResetWatchPasswordController } from "../../controllers/accountAuth.controller.js";
import { accountAuthMiddleware } from "../../middlewares/accountAuth.middleware.js";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { adminAuth } from "../../middlewares/adminAuth.middleware.js";

const router = express.Router();

router.post("/login", accountLoginController);
router.get("/me", accountAuthMiddleware, getAccountProfileController);
// reset trade password
router.post("/:accountId/reset-trade-password",authMiddleware,resetTradePasswordController);
// watch password reset
router.post("/:accountId/reset-watch-password",authMiddleware,resetWatchPasswordController);
// admin reset passwords
router.post("/admin/:accountId/reset-trade-password", authMiddleware, adminAuth, adminResetTradePasswordController);
router.post("/admin/:accountId/reset-watch-password", authMiddleware, adminAuth, adminResetWatchPasswordController);

export default router;
