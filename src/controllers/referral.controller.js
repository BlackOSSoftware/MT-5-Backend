import {
  getReferralSummaryService,
  getAdminUserReferralSummaryService,
  listReferralRewardsService,
  listMyDirectReferralsService,
  requestReferralRewardService,
  adminListReferralRewardsService,
  adminApproveReferralRewardService,
  adminRejectReferralRewardService,
} from "../services/referral.service.js";
import {
  getReferralDashboardService,
  getMyReferralTreeService,
  listNetworkDepositsService,
  listNetworkWithdrawalsService,
  listNetworkMembersService,
  listNetworkKycService,
  listNetworkAccountsService,
  getReferralChartService,
} from "../services/referralDashboard.service.js";
import {
  createSubIbRequestService,
  listSubIbRequestsService,
  listUserIbRequestsService,
  getMySubIbRequestService,
  getIbRequestStatusService,
  respondSubIbRequestService,
} from "../services/ibRequest.service.js";
import {
  adminGetReferralTreeService,
  adminListReferralLinksService,
  adminListReferralNetworkService,
  adminReferralNetworkSummaryService,
} from "../services/referralReport.service.js";
import ReferralReward from "../models/ReferralReward.model.js";
import { assertUserBelongsToBroker } from "../utils/brokerScope.js";

export async function getMyReferralSummary(req, res) {
  try {
    const data = await getReferralSummaryService(req.user._id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function getMyReferralChart(req, res) {
  try {
    const { from, to } = req.query;
    const data = await getReferralChartService({
      userId: req.user._id,
      from,
      to,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function getMyReferralDashboard(req, res) {
  try {
    const { scope, period, from, to } = req.query;
    const data = await getReferralDashboardService({
      userId: req.user._id,
      scope,
      period,
      from,
      to,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminGetUserIbDashboard(req, res) {
  try {
    const brokerId = req.brokerId || null;
    await assertUserBelongsToBroker(req.params.userId, brokerId);
    const { scope, period, from, to } = req.query;
    const data = await getReferralDashboardService({
      userId: req.params.userId,
      scope,
      period,
      from,
      to,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function adminListUserIbKyc(req, res) {
  try {
    const brokerId = req.brokerId || null;
    await assertUserBelongsToBroker(req.params.userId, brokerId);
    const { q, status, page = 1, limit = 20 } = req.query;
    const data = await listNetworkKycService({
      userId: req.params.userId,
      q,
      status,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function adminListUserIbAccounts(req, res) {
  try {
    const brokerId = req.brokerId || null;
    await assertUserBelongsToBroker(req.params.userId, brokerId);
    const { q, page = 1, limit = 20 } = req.query;
    const data = await listNetworkAccountsService({
      userId: req.params.userId,
      q,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function adminListUserIbRequests(req, res) {
  try {
    const brokerId = req.brokerId || null;
    await assertUserBelongsToBroker(req.params.userId, brokerId);
    const { status, page = 1, limit = 50 } = req.query;
    const result = await listUserIbRequestsService({
      userId: req.params.userId,
      status,
      page: Number(page),
      limit: Number(limit),
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function adminGetUserReferralSummary(req, res) {
  try {
    const brokerId = req.brokerId || null;
    await assertUserBelongsToBroker(req.params.userId, brokerId);
    const data = await getAdminUserReferralSummaryService(req.params.userId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function listMyReferralRewards(req, res) {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const result = await listReferralRewardsService({
      userId: req.user._id,
      status,
      page: Number(page),
      limit: Number(limit),
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function listMyDirectReferrals(req, res) {
  try {
    const { page = 1, limit = 50 } = req.query;
    const result = await listMyDirectReferralsService({
      userId: req.user._id,
      page: Number(page),
      limit: Number(limit),
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function requestReferralReward(req, res) {
  try {
    const { rewardId, accountId, destination } = req.body;
    const data = await requestReferralRewardService({
      userId: req.user._id,
      rewardId,
      accountId,
      destination,
    });
    return res.status(200).json({
      success: true,
      message: "Referral reward request submitted",
      data,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminListReferralRewards(req, res) {
  try {
    const {
      status,
      page = 1,
      limit = 20,
      referrerUserId,
      referredUserId,
      createdFrom,
      createdTo,
      requestedFrom,
      requestedTo,
      approvedFrom,
      approvedTo,
      rejectedFrom,
      rejectedTo,
    } = req.query;
    const result = await adminListReferralRewardsService({
      status,
      page: Number(page),
      limit: Number(limit),
      referrerUserId,
      referredUserId,
      createdFrom,
      createdTo,
      requestedFrom,
      requestedTo,
      approvedFrom,
      approvedTo,
      rejectedFrom,
      rejectedTo,
      brokerId: req.brokerId || null,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

async function assertRewardBelongsToBroker(rewardId, brokerId) {
  if (!brokerId) return;
  const reward = await ReferralReward.findById(rewardId)
    .select("referrer_user referred_user")
    .lean();
  if (!reward) {
    const err = new Error("Referral reward not found");
    err.status = 404;
    throw err;
  }
  const scopedUserId = reward.referrer_user || reward.referred_user;
  await assertUserBelongsToBroker(scopedUserId, brokerId);
}

export async function adminApproveReferralReward(req, res) {
  try {
    const brokerId = req.brokerId || null;
    await assertRewardBelongsToBroker(req.params.rewardId, brokerId);
    const data = await adminApproveReferralRewardService({
      adminId: req.user._id,
      rewardId: req.params.rewardId,
      brokerId,
    });
    return res.status(200).json({
      success: true,
      message: "Referral reward approved",
      data,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function adminRejectReferralReward(req, res) {
  try {
    const brokerId = req.brokerId || null;
    await assertRewardBelongsToBroker(req.params.rewardId, brokerId);
    const { reason } = req.body;
    const data = await adminRejectReferralRewardService({
      adminId: req.user._id,
      rewardId: req.params.rewardId,
      reason,
      brokerId,
    });
    return res.status(200).json({
      success: true,
      message: "Referral reward rejected",
      data,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function adminReferralNetworkSummary(req, res) {
  try {
    const data = await adminReferralNetworkSummaryService({
      brokerId: req.brokerId || null,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminListReferralNetwork(req, res) {
  try {
    const { q, page = 1, limit = 20, onlyReferrers } = req.query;
    const result = await adminListReferralNetworkService({
      q,
      page: Number(page),
      limit: Number(limit),
      onlyReferrers:
        onlyReferrers === undefined
          ? true
          : String(onlyReferrers).toLowerCase() !== "false",
      brokerId: req.brokerId || null,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminListReferralLinks(req, res) {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const result = await adminListReferralLinksService({
      q,
      page: Number(page),
      limit: Number(limit),
      brokerId: req.brokerId || null,
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminGetReferralTree(req, res) {
  try {
    const brokerId = req.brokerId || null;
    await assertUserBelongsToBroker(req.params.userId, brokerId);
    const { maxDepth } = req.query;
    const data = await adminGetReferralTreeService(req.params.userId, {
      maxDepth: maxDepth ? Number(maxDepth) : 8,
      brokerId,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function listMyNetworkDeposits(req, res) {
  try {
    const { from, to, method, status, page = 1, limit = 20 } = req.query;
    const data = await listNetworkDepositsService({
      userId: req.user._id,
      from,
      to,
      method,
      status,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err?.message || "Failed to load deposits",
    });
  }
}

export async function listMyNetworkWithdrawals(req, res) {
  try {
    const { from, to, method, status, page = 1, limit = 20 } = req.query;
    const data = await listNetworkWithdrawalsService({
      userId: req.user._id,
      from,
      to,
      method,
      status,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err?.message || "Failed to load withdrawals",
    });
  }
}

export async function listMyNetworkMembers(req, res) {
  try {
    const { q, level, page = 1, limit = 20 } = req.query;
    const data = await listNetworkMembersService({
      userId: req.user._id,
      q,
      level,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err?.message || "Failed to load team members",
    });
  }
}

export async function getMyReferralTree(req, res) {
  try {
    const { maxDepth } = req.query;
    const data = await getMyReferralTreeService({
      userId: req.user._id,
      maxDepth: maxDepth ? Number(maxDepth) : 6,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function listMyNetworkKyc(req, res) {
  try {
    const { q, status, page = 1, limit = 20 } = req.query;
    const data = await listNetworkKycService({
      userId: req.user._id,
      q,
      status,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err?.message || "Failed to load KYC records",
    });
  }
}

export async function listMyNetworkAccounts(req, res) {
  try {
    const { q, page = 1, limit = 20 } = req.query;
    const data = await listNetworkAccountsService({
      userId: req.user._id,
      q,
      page,
      limit,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err?.message || "Failed to load accounts",
    });
  }
}

export async function getMyIbRequestStatus(req, res) {
  try {
    const data = await getIbRequestStatusService({ userId: req.user._id });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function createMySubIbRequest(req, res) {
  try {
    const data = await createSubIbRequestService({
      userId: req.user._id,
      note: req.body?.note,
    });
    return res.status(201).json({
      success: true,
      message: "Sub-IB request sent",
      data,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function getMySubIbRequest(req, res) {
  try {
    const data = await getMySubIbRequestService({ userId: req.user._id });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function listSubIbRequests(req, res) {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const result = await listSubIbRequestsService({
      ibId: req.user._id,
      status,
      page: Number(page),
      limit: Number(limit),
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function respondSubIbRequest(req, res) {
  try {
    const { action, reason } = req.body || {};
    const data = await respondSubIbRequestService({
      ibId: req.user._id,
      requestId: req.params.requestId,
      action,
      reason,
    });
    return res.status(200).json({
      success: true,
      message: action === "APPROVE" ? "Sub-IB request approved" : "Sub-IB request rejected",
      data,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}
