import express from "express";
import { accountLoginController, refreshAccountSessionController, getAccountProfileController, resetTradePasswordController, resetWatchPasswordController, adminResetTradePasswordController, adminResetWatchPasswordController } from "../../controllers/accountAuth.controller.js";
import { accountAuthMiddleware } from "../../middlewares/accountAuth.middleware.js";
import { changeAccountPasswordService } from "../../services/accountPassword.service.js";

async function changeAccountPasswordController(req, res) {
  try {
    if (req.account?.sessionType !== "TRADE") {
      return res.status(403).json({ message: "You do not have permission" });
    }
    const { kind, currentPassword, newPassword } = req.body || {};
    const result = await changeAccountPasswordService({
      accountId: req.account.accountId,
      kind,
      currentPassword,
      newPassword,
    });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";

const router = express.Router();

router.post("/login", accountLoginController);
router.post("/refresh", refreshAccountSessionController);
router.get("/me", accountAuthMiddleware, getAccountProfileController);
// MT5 app: master / investor / trader / money manager password change
router.post("/change-password", accountAuthMiddleware, changeAccountPasswordController);
// reset trade password
router.post("/:accountId/reset-trade-password",authMiddleware,resetTradePasswordController);
// watch password reset
router.post("/:accountId/reset-watch-password",authMiddleware,resetWatchPasswordController);
// admin reset passwords
router.post("/admin/:accountId/reset-trade-password", brokerAdminAuth, adminResetTradePasswordController);
router.post("/admin/:accountId/reset-watch-password", brokerAdminAuth, adminResetWatchPasswordController);

export default router;
