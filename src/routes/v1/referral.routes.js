import express from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";
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
  brokerAdminAuth,
  adminGetUserReferralSummary,
);
router.get(
  "/admin/network/summary",
  brokerAdminAuth,
  adminReferralNetworkSummary,
);
router.get(
  "/admin/network/links",
  brokerAdminAuth,
  adminListReferralLinks,
);
router.get(
  "/admin/network/:userId/tree",
  brokerAdminAuth,
  adminGetReferralTree,
);
router.get(
  "/admin/network",
  brokerAdminAuth,
  adminListReferralNetwork,
);

router.get("/admin/rewards", brokerAdminAuth, adminListReferralRewards);
router.patch(
  "/admin/:rewardId/approve",
  brokerAdminAuth,
  adminApproveReferralReward,
);
router.patch(
  "/admin/:rewardId/reject",
  brokerAdminAuth,
  adminRejectReferralReward,
);

export default router;
