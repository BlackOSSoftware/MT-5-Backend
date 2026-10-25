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
  adminGetReferralTreeService,
  adminListReferralLinksService,
  adminListReferralNetworkService,
  adminReferralNetworkSummaryService,
} from "../services/referralReport.service.js";

export async function getMyReferralSummary(req, res) {
  try {
    const data = await getReferralSummaryService(req.user._id);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminGetUserReferralSummary(req, res) {
  try {
    const data = await getAdminUserReferralSummaryService(req.params.userId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
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
    const { rewardId, accountId } = req.body;
    const data = await requestReferralRewardService({
      userId: req.user._id,
      rewardId,
      accountId,
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
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminApproveReferralReward(req, res) {
  try {
    const data = await adminApproveReferralRewardService({
      adminId: req.user._id,
      rewardId: req.params.rewardId,
    });
    return res.status(200).json({
      success: true,
      message: "Referral reward approved",
      data,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminRejectReferralReward(req, res) {
  try {
    const { reason } = req.body;
    const data = await adminRejectReferralRewardService({
      adminId: req.user._id,
      rewardId: req.params.rewardId,
      reason,
    });
    return res.status(200).json({
      success: true,
      message: "Referral reward rejected",
      data,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminReferralNetworkSummary(req, res) {
  try {
    const data = await adminReferralNetworkSummaryService();
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
    });
    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminGetReferralTree(req, res) {
  try {
    const { maxDepth } = req.query;
    const data = await adminGetReferralTreeService(req.params.userId, {
      maxDepth: maxDepth ? Number(maxDepth) : 8,
    });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}
