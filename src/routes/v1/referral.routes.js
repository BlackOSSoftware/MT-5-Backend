import express from "express";
import { authMiddleware } from "../../middlewares/auth.middleware.js";
import { brokerAdminAuth, requireBrokerPermission } from "../../middlewares/brokerAuth.middleware.js";
import { requireIbDashboardAccess } from "../../utils/ibAccess.js";

// Every /admin/* route in this file requires settings.referral.
const referralAdminAuth = [
  brokerAdminAuth,
  requireBrokerPermission("settings.referral"),
];
import {
  getMyReferralSummary,
  getMyReferralChart,
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
  adminGetUserIbDashboard,
  adminListUserIbKyc,
  adminListUserIbAccounts,
  adminListUserIbRequests,
  adminListIbRequests,
  adminRespondIbRequest,
  getMyReferralTree,
  listMyNetworkDeposits,
  listMyNetworkWithdrawals,
  listMyNetworkMembers,
  listMyNetworkKyc,
  listMyNetworkAccounts,
  getMyIbRequestStatus,
  createMySubIbRequest,
  getMySubIbRequest,
  listSubIbRequests,
  respondSubIbRequest,
} from "../../controllers/referral.controller.js";

const router = express.Router();

// User routes
router.get("/summary", authMiddleware, requireIbDashboardAccess, getMyReferralSummary);
router.get("/dashboard", authMiddleware, requireIbDashboardAccess, getMyReferralDashboard);
router.get("/chart", authMiddleware, requireIbDashboardAccess, getMyReferralChart);
router.get("/rewards", authMiddleware, requireIbDashboardAccess, listMyReferralRewards);
router.get("/mine", authMiddleware, requireIbDashboardAccess, listMyDirectReferrals);
router.post("/request", authMiddleware, requireIbDashboardAccess, requestReferralReward);
router.get("/tree", authMiddleware, requireIbDashboardAccess, getMyReferralTree);
router.get("/deposits", authMiddleware, requireIbDashboardAccess, listMyNetworkDeposits);
router.get("/withdrawals", authMiddleware, requireIbDashboardAccess, listMyNetworkWithdrawals);
router.get("/members", authMiddleware, requireIbDashboardAccess, listMyNetworkMembers);
router.get("/kyc", authMiddleware, requireIbDashboardAccess, listMyNetworkKyc);
router.get("/accounts", authMiddleware, requireIbDashboardAccess, listMyNetworkAccounts);
// Referred clients (no IB gate) — request IB dashboard access from their referrer
router.get("/ib-request-status", authMiddleware, getMyIbRequestStatus);
router.post("/ib-request", authMiddleware, createMySubIbRequest);
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
  ...referralAdminAuth,
  adminGetUserReferralSummary,
);
router.get(
  "/admin/users/:userId/ib-dashboard",
  ...referralAdminAuth,
  adminGetUserIbDashboard,
);
router.get(
  "/admin/users/:userId/ib-kyc",
  ...referralAdminAuth,
  adminListUserIbKyc,
);
router.get(
  "/admin/users/:userId/ib-accounts",
  ...referralAdminAuth,
  adminListUserIbAccounts,
);
router.get(
  "/admin/users/:userId/ib-requests",
  ...referralAdminAuth,
  adminListUserIbRequests,
);
router.get(
  "/admin/ib-requests",
  ...referralAdminAuth,
  adminListIbRequests,
);
router.patch(
  "/admin/ib-requests/:requestId",
  ...referralAdminAuth,
  adminRespondIbRequest,
);
router.get(
  "/admin/network/summary",
  ...referralAdminAuth,
  adminReferralNetworkSummary,
);
router.get(
  "/admin/network/links",
  ...referralAdminAuth,
  adminListReferralLinks,
);
router.get(
  "/admin/network/:userId/tree",
  ...referralAdminAuth,
  adminGetReferralTree,
);
router.get(
  "/admin/network",
  ...referralAdminAuth,
  adminListReferralNetwork,
);

router.get("/admin/rewards", ...referralAdminAuth, adminListReferralRewards);
router.patch(
  "/admin/:rewardId/approve",
  ...referralAdminAuth,
  adminApproveReferralReward,
);
router.patch(
  "/admin/:rewardId/reject",
  ...referralAdminAuth,
  adminRejectReferralReward,
);

export default router;
