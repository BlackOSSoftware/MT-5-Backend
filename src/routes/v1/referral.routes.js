import express from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";
import { requireIbDashboardAccess } from "../../utils/ibAccess.js";
import {
  getMyReferralSummary,
  getMyReferralDashboard,
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
  getMyReferralTree,
  createMySubIbRequest,
  getMySubIbRequest,
  listSubIbRequests,
  respondSubIbRequest,
} from "../../controllers/referral.controller.js";

const router = express.Router();

// User routes
router.get("/summary", authMiddleware, requireIbDashboardAccess, getMyReferralSummary);
router.get("/dashboard", authMiddleware, requireIbDashboardAccess, getMyReferralDashboard);
router.get("/rewards", authMiddleware, requireIbDashboardAccess, listMyReferralRewards);
router.get("/mine", authMiddleware, requireIbDashboardAccess, listMyDirectReferrals);
router.post("/request", authMiddleware, requireIbDashboardAccess, requestReferralReward);
router.get("/tree", authMiddleware, requireIbDashboardAccess, getMyReferralTree);
router.post("/sub-ib-request", authMiddleware, requireIbDashboardAccess, createMySubIbRequest);
router.get("/sub-ib-request/mine", authMiddleware, requireIbDashboardAccess, getMySubIbRequest);
router.get("/sub-ib-requests", authMiddleware, requireIbDashboardAccess, listSubIbRequests);
router.patch(
  "/sub-ib-requests/:requestId",
  authMiddleware,
  requireIbDashboardAccess,
  respondSubIbRequest,
);

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
