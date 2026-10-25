import express from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { adminAuth } from "../../middlewares/adminAuth.middleware.js";
import {
  getMyReferralSummary,
  listMyReferralRewards,
  listMyDirectReferrals,
  requestReferralReward,
  adminListReferralRewards,
  adminApproveReferralReward,
  adminRejectReferralReward,
  adminReferralNetworkSummary,
  adminListReferralNetwork,
  adminListReferralLinks,
  adminGetReferralTree,
  adminGetUserReferralSummary,
} from "../../controllers/referral.controller.js";

const router = express.Router();

// User routes
router.get("/summary", authMiddleware, getMyReferralSummary);
router.get("/rewards", authMiddleware, listMyReferralRewards);
router.get("/mine", authMiddleware, listMyDirectReferrals);
router.post("/request", authMiddleware, requestReferralReward);

// Admin routes — network report (before :rewardId routes)
router.get(
  "/admin/users/:userId/summary",
  authMiddleware,
  adminAuth,
  adminGetUserReferralSummary,
);
router.get(
  "/admin/network/summary",
  authMiddleware,
  adminAuth,
  adminReferralNetworkSummary,
);
router.get(
  "/admin/network/links",
  authMiddleware,
  adminAuth,
  adminListReferralLinks,
);
router.get(
  "/admin/network/:userId/tree",
  authMiddleware,
  adminAuth,
  adminGetReferralTree,
);
router.get(
  "/admin/network",
  authMiddleware,
  adminAuth,
  adminListReferralNetwork,
);

router.get("/admin/rewards", authMiddleware, adminAuth, adminListReferralRewards);
router.patch(
  "/admin/:rewardId/approve",
  authMiddleware,
  adminAuth,
  adminApproveReferralReward,
);
router.patch(
  "/admin/:rewardId/reject",
  authMiddleware,
  adminAuth,
  adminRejectReferralReward,
);

export default router;
