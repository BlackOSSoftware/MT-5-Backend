import mongoose from "mongoose";
import Referral from "../models/Referral.model.js";
import ReferralReward from "../models/ReferralReward.model.js";
import Account from "../models/Account.model.js";
import AccountPlan from "../models/AccountPlan.model.js";
import Transaction from "../models/Transaction.model.js";
import { generateReferralCode } from "../utils/referralCode.util.js";
import EngineSync from "../trade-engine/EngineSync.js";
import { publishAccountBalance } from "../trade-engine/EngineSyncBus.js";
import {
  assertUserBelongsToBroker,
  getBrokerUserIds,
} from "../utils/brokerScope.js";

const REWARD_STATUSES = new Set(["ELIGIBLE", "REQUESTED", "APPROVED", "REJECTED"]);

async function ensureReferralProfile(userId, session = null) {
  const options = { new: true, upsert: true };
  if (session) options.session = session;

  // Create a referral profile lazily if it doesn't exist (safe default).
  return Referral.findOneAndUpdate(
    { user_id: userId },
    {
      $setOnInsert: {
        user_id: userId,
        referral_code: generateReferralCode(),
        referred_by: null,
        status: "CONFIRMED",
      },
    },
    options,
  ).lean();
}

async function buildReferralSummaryPayload(userId, referral) {
  const pendingAgg = await ReferralReward.aggregate([
    {
      $match: {
        referrer_user: new mongoose.Types.ObjectId(userId),
        status: { $in: ["ELIGIBLE", "REQUESTED"] },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        amount: { $sum: "$reward_amount" },
      },
    },
  ]);

  const pending = pendingAgg?.[0] || { count: 0, amount: 0 };

  return {
    referralCode: referral?.referral_code || null,
    totalReferrals: referral?.total_referrals || 0,
    referralBalance: referral?.referral_balance || 0,
    totalEarned: referral?.total_earned || 0,
    pendingCount: pending.count || 0,
    pendingAmount: pending.amount || 0,
    status: referral?.status || null,
    referredBy: referral?.referred_by ? String(referral.referred_by) : null,
  };
}

export async function getReferralSummaryService(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  const referral = await ensureReferralProfile(userId);
  return buildReferralSummaryPayload(userId, referral);
}

/** Admin read-only summary — does not create a referral profile. */
export async function getAdminUserReferralSummaryService(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  const referral = await Referral.findOne({ user_id: userId }).lean();
  return buildReferralSummaryPayload(userId, referral);
}

function toPublicUserCard(user) {
  if (!user) return null;
  if (typeof user !== "object") {
    return { _id: String(user), name: "", email: "" };
  }
  return {
    _id: user._id ? String(user._id) : undefined,
    name: user.name || "",
    email: user.email || "",
  };
}

export async function listReferralRewardsService({
  userId,
  status,
  page = 1,
  limit = 20,
}) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const filter = { referrer_user: userId };

  if (status) {
    const safeStatus = String(status).trim().toUpperCase();
    if (!REWARD_STATUSES.has(safeStatus)) {
      throw new Error("Invalid status filter");
    }
    filter.status = safeStatus;
  }

  const [docs, total] = await Promise.all([
    ReferralReward.find(filter)
      .populate("referred_user", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ReferralReward.countDocuments(filter),
  ]);

  const items = docs.map((doc) => {
    const referred = toPublicUserCard(doc.referred_user);
    const amount = Number(doc.reward_amount) || 0;
    return {
      _id: doc._id,
      rewardId: String(doc._id),
      status: doc.status,
      reward_amount: amount,
      amount,
      rewardAmount: amount,
      referred_user: doc.referred_user,
      referredUser: referred,
      referredUserName: referred?.name || "",
      referredUserEmail: referred?.email || "",
      requested_at: doc.requested_at || null,
      approved_at: doc.approved_at || null,
      rejected_at: doc.rejected_at || null,
      requestedAt: doc.requested_at || null,
      approvedAt: doc.approved_at || null,
      rejectedAt: doc.rejected_at || null,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  });

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

/** People this user directly referred (signup via their code). */
export async function listMyDirectReferralsService({
  userId,
  page = 1,
  limit = 50,
}) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const filter = { referred_by: userId };

  const [docs, total] = await Promise.all([
    Referral.find(filter)
      .populate("user_id", "name email phone kycStatus isMailVerified")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Referral.countDocuments(filter),
  ]);

  const items = docs.map((doc) => {
    const user = toPublicUserCard(doc.user_id);
    return {
      userId: user?._id || (doc.user_id ? String(doc.user_id) : null),
      user,
      name: user?.name || "",
      email: user?.email || "",
      referralCode: doc.referral_code || null,
      status: doc.status || null,
      createdAt: doc.createdAt || null,
    };
  });

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

export async function requestReferralRewardService({
  userId,
  rewardId,
  accountId,
}) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }
  if (!mongoose.isValidObjectId(rewardId)) {
    throw new Error("Invalid rewardId");
  }
  if (!mongoose.isValidObjectId(accountId)) {
    throw new Error("Invalid accountId");
  }

  const account = await Account.findOne({
    _id: accountId,
    user_id: userId,
    status: "active",
  })
    .select("_id account_type")
    .lean();

  if (!account) {
    throw new Error("Account not found");
  }

  if (account.account_type !== "live") {
    throw new Error("Referral reward can be credited only to a live account");
  }

  const updated = await ReferralReward.findOneAndUpdate(
    { _id: rewardId, referrer_user: userId, status: "ELIGIBLE" },
    {
      $set: {
        requested_account: accountId,
        requested_at: new Date(),
        status: "REQUESTED",
      },
    },
    { new: true },
  ).lean();

  if (!updated) {
    throw new Error("Referral reward is not eligible for request");
  }

  return updated;
}

export async function adminListReferralRewardsService({
  page = 1,
  limit = 20,
  status,
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
  brokerId = null,
}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const filter = {};

  const parseDate = (value, fieldName) => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid ${fieldName}`);
    }
    return date;
  };

  const applyRange = (field, fromValue, toValue, label) => {
    const from = parseDate(fromValue, `${label}From`);
    const to = parseDate(toValue, `${label}To`);
    if (from || to) {
      filter[field] = {};
      if (from) filter[field].$gte = from;
      if (to) filter[field].$lte = to;
    }
  };

  if (status) {
    const safeStatus = String(status).trim().toUpperCase();
    if (!REWARD_STATUSES.has(safeStatus)) {
      throw new Error("Invalid status filter");
    }
    filter.status = safeStatus;
  }

  if (referrerUserId) {
    if (!mongoose.isValidObjectId(referrerUserId)) {
      throw new Error("Invalid referrerUserId");
    }
    filter.referrer_user = referrerUserId;
  }

  if (referredUserId) {
    if (!mongoose.isValidObjectId(referredUserId)) {
      throw new Error("Invalid referredUserId");
    }
    filter.referred_user = referredUserId;
  }

  if (brokerId) {
    const brokerUserIds = await getBrokerUserIds(brokerId);
    const idSet = new Set((brokerUserIds || []).map((id) => String(id)));
    if (filter.referrer_user != null) {
      const requested = String(filter.referrer_user);
      filter.referrer_user = idSet.has(requested)
        ? filter.referrer_user
        : { $in: [] };
    } else {
      filter.referrer_user = { $in: brokerUserIds || [] };
    }
  }

  applyRange("createdAt", createdFrom, createdTo, "created");
  applyRange("requested_at", requestedFrom, requestedTo, "requested");
  applyRange("approved_at", approvedFrom, approvedTo, "approved");
  applyRange("rejected_at", rejectedFrom, rejectedTo, "rejected");

  const [docs, total] = await Promise.all([
    ReferralReward.find(filter)
      .populate("referrer_user", "name email phone")
      .populate("referred_user", "name email phone")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    ReferralReward.countDocuments(filter),
  ]);

  const toUserCard = (user) => {
    if (!user) return null;
    if (typeof user !== "object") {
      return { _id: String(user) };
    }
    return {
      _id: user._id ? String(user._id) : undefined,
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
    };
  };

  const items = docs.map((doc) => {
    const referrerUser = toUserCard(doc.referrer_user);
    const referredUser = toUserCard(doc.referred_user);
    const amount = Number(doc.reward_amount) || 0;

    return {
      _id: doc._id,
      status: doc.status,
      reward_amount: amount,
      amount,
      rewardAmount: amount,
      referrer_user: doc.referrer_user,
      referred_user: doc.referred_user,
      referrerUser,
      referredUser,
      referrer: referrerUser,
      referred: referredUser,
      referrerUserId: referrerUser?._id || null,
      referredUserId: referredUser?._id || null,
      requested_at: doc.requested_at || null,
      approved_at: doc.approved_at || null,
      rejected_at: doc.rejected_at || null,
      rejection_reason: doc.rejection_reason || "",
      requestedAt: doc.requested_at || null,
      approvedAt: doc.approved_at || null,
      rejectedAt: doc.rejected_at || null,
      rejectionReason: doc.rejection_reason || "",
      plan_id: doc.plan_id,
      deposit_id: doc.deposit_id,
      referred_account: doc.referred_account,
      requested_account: doc.requested_account,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  });

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

export async function adminApproveReferralRewardService({
  adminId,
  rewardId,
  brokerId = null,
}) {
  if (!mongoose.isValidObjectId(adminId)) {
    throw new Error("Invalid adminId");
  }
  if (!mongoose.isValidObjectId(rewardId)) {
    throw new Error("Invalid rewardId");
  }

  if (brokerId) {
    const existing = await ReferralReward.findById(rewardId)
      .select("referrer_user referred_user")
      .lean();
    if (!existing) {
      throw new Error("Referral reward not found");
    }
    await assertUserBelongsToBroker(
      existing.referrer_user || existing.referred_user,
      brokerId,
    );
  }

  const session = await mongoose.startSession();
  let result = null;

  try {
    await session.withTransaction(async () => {
      const reward = await ReferralReward.findById(rewardId).session(session);
      if (!reward) {
        throw new Error("Referral reward not found");
      }
      if (reward.status !== "REQUESTED") {
        throw new Error("Referral reward is not requested");
      }
      if (!reward.requested_account) {
        throw new Error("Requested account is missing");
      }

      const amount = Number(reward.reward_amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Invalid reward amount");
      }

      const account = await Account.findOne({
        _id: reward.requested_account,
        user_id: reward.referrer_user,
        status: "active",
      }).session(session);

      if (!account) {
        throw new Error("Requested account not found or inactive");
      }

      const newBalance = Number(account.balance) + amount;
      const newEquity =
        Number(newBalance) + Number(account.bonus_balance || 0);

      await Account.updateOne(
        { _id: account._id },
        { $set: { balance: newBalance, equity: newEquity } },
        { session },
      );

      await Transaction.create(
        [
          {
            user: reward.referrer_user,
            account: account._id,
            type: "REFERRAL",
            amount,
            balanceAfter: newBalance,
            equityAfter: newEquity,
            status: "SUCCESS",
            referenceType: "SYSTEM",
            referenceId: reward._id,
            createdBy: adminId,
            remark: "Referral reward approved",
          },
        ],
        { session },
      );

      await Referral.updateOne(
        { user_id: reward.referrer_user },
        {
          $inc: {
            total_referrals: 1,
            total_earned: amount,
            referral_balance: amount,
          },
        },
        { session, upsert: true },
      );

      await Referral.updateOne(
        { user_id: reward.referred_user },
        { $set: { status: "CONFIRMED" } },
        { session },
      );

      reward.status = "APPROVED";
      reward.approved_by = adminId;
      reward.approved_at = new Date();
      await reward.save({ session });

      result = {
        rewardId: reward._id,
        accountId: account._id,
        amount,
        newBalance,
      };
    });
  } finally {
    session.endSession();
  }

  if (result?.accountId && Number.isFinite(result?.newBalance)) {
    try {
      publishAccountBalance(String(result.accountId), result.newBalance);
      await EngineSync.updateBalance(String(result.accountId), result.newBalance);
    } catch (err) {
      console.error(
        "[REFERRAL] EngineSync.updateBalance failed (approve)",
        err?.message || err,
      );
    }
  }

  return result;
}

export async function adminRejectReferralRewardService({
  adminId,
  rewardId,
  reason,
  brokerId = null,
}) {
  if (!mongoose.isValidObjectId(adminId)) {
    throw new Error("Invalid adminId");
  }
  if (!mongoose.isValidObjectId(rewardId)) {
    throw new Error("Invalid rewardId");
  }

  if (brokerId) {
    const existing = await ReferralReward.findById(rewardId)
      .select("referrer_user referred_user")
      .lean();
    if (!existing) {
      throw new Error("Referral reward not found");
    }
    await assertUserBelongsToBroker(
      existing.referrer_user || existing.referred_user,
      brokerId,
    );
  }

  const rejectionReason =
    typeof reason === "string" && reason.trim() ? reason.trim() : "Rejected";

  const updated = await ReferralReward.findOneAndUpdate(
    { _id: rewardId, status: "REQUESTED" },
    {
      $set: {
        status: "REJECTED",
        rejected_by: adminId,
        rejected_at: new Date(),
        rejection_reason: rejectionReason,
      },
    },
    { new: true },
  ).lean();

  if (!updated) {
    throw new Error("Referral reward is not in requested state");
  }

  return updated;
}

export async function createReferralRewardEligibility({
  referredUserId,
  referredAccountId,
  planId,
  depositId,
  session = null,
}) {
  if (!referredUserId || !referredAccountId || !planId || !depositId) return;

  const referral = await Referral.findOne({
    user_id: referredUserId,
  })
    .select("referred_by")
    .session(session)
    .lean();

  if (!referral?.referred_by) return;

  const plan = await AccountPlan.findById(planId)
    .select("referral_reward_amount")
    .session(session)
    .lean();

  const rewardAmount = Number(plan?.referral_reward_amount || 0);
  if (!Number.isFinite(rewardAmount) || rewardAmount <= 0) return;

  // One-time reward per referred user (unique index on referred_user).
  await ReferralReward.updateOne(
    { referred_user: referredUserId },
    {
      $setOnInsert: {
        referred_user: referredUserId,
        referrer_user: referral.referred_by,
        referred_account: referredAccountId,
        plan_id: planId,
        deposit_id: depositId,
        reward_amount: rewardAmount,
        status: "ELIGIBLE",
      },
    },
    { upsert: true, session },
  );
}
