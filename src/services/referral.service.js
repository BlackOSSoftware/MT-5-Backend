import mongoose from "mongoose";
import Referral from "../models/Referral.model.js";
import ReferralReward from "../models/ReferralReward.model.js";
import Account from "../models/Account.model.js";
import AccountPlan from "../models/AccountPlan.model.js";
import Deposit from "../models/Deposit.model.js";
import Transaction from "../models/Transaction.model.js";
import User from "../models/User.model.js";
import IbCommission from "../models/IbCommission.model.js";
import WalletTransaction from "../models/WalletTransaction.model.js";
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
  const objectId = new mongoose.Types.ObjectId(userId);
  const [pendingAgg, directAgg, ibAgg] = await Promise.all([
    ReferralReward.aggregate([
      {
        $match: {
          referrer_user: objectId,
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
    ]),
    Referral.aggregate([
      { $match: { referred_by: objectId } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]),
    IbCommission.aggregate([
      {
        $match: {
          ib_user_id: objectId,
          status: { $in: ["PENDING", "AVAILABLE", "PAID", "CLAWBACK_PENDING"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          remaining: {
            $sum: { $subtract: ["$amount", { $ifNull: ["$paid_amount", 0] }] },
          },
        },
      },
    ]),
  ]);

  const pending = pendingAgg?.[0] || { count: 0, amount: 0 };
  const ib = ibAgg?.[0] || null;
  const ibTotal = Number(ib?.total || 0);
  const ibRemaining = Math.max(0, Number(ib?.remaining || 0));
  const directCount = Number(directAgg?.[0]?.count || 0);

  return {
    referralCode: referral?.referral_code || null,
    totalReferrals: directCount || referral?.total_referrals || 0,
    referralBalance: ib ? ibRemaining : referral?.referral_balance || 0,
    totalEarned: ibTotal || referral?.total_earned || 0,
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
  try {
    await syncMissingReferralRewardsForReferrer(userId);
  } catch {
    /* non-fatal */
  }
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

  try {
    await syncMissingReferralRewardsForReferrer(userId);
  } catch {
    /* non-fatal backfill */
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

  const referredIds = docs
    .map((doc) => {
      const id = doc.user_id?._id || doc.user_id;
      return id ? new mongoose.Types.ObjectId(String(id)) : null;
    })
    .filter(Boolean);

  // Total approved deposits only (excludes bonus / referral credits).
  const depositAgg =
    referredIds.length === 0
      ? []
      : await Deposit.aggregate([
          {
            $match: {
              user: { $in: referredIds },
              status: "APPROVED",
            },
          },
          {
            $group: {
              _id: "$user",
              totalDeposit: { $sum: "$amount" },
              depositCount: { $sum: 1 },
            },
          },
        ]);

  const accountAgg =
    referredIds.length === 0
      ? []
      : await Account.aggregate([
          {
            $match: {
              user_id: { $in: referredIds },
            },
          },
          {
            $group: {
              _id: "$user_id",
              accountCount: { $sum: 1 },
            },
          },
        ]);

  const depositByUser = new Map(
    depositAgg.map((row) => [String(row._id), row]),
  );
  const accountsByUser = new Map(
    accountAgg.map((row) => [String(row._id), row]),
  );

  const items = docs.map((doc) => {
    const user = toPublicUserCard(doc.user_id);
    const uid = user?._id || (doc.user_id ? String(doc.user_id) : null);
    const dep = uid ? depositByUser.get(String(uid)) : null;
    const acc = uid ? accountsByUser.get(String(uid)) : null;
    return {
      userId: uid,
      user,
      name: user?.name || "",
      email: user?.email || "",
      referralCode: doc.referral_code || null,
      status: doc.status || null,
      createdAt: doc.createdAt || null,
      totalDeposit: Number(dep?.totalDeposit) || 0,
      depositCount: Number(dep?.depositCount) || 0,
      accountCount: Number(acc?.accountCount) || 0,
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

/**
 * Portal Request Payout: instantly credit reward as bonus_balance (credit)
 * on the referrer's selected live account. No admin wait.
 */
export async function requestReferralRewardService({
  userId,
  rewardId,
  accountId,
  destination = "account",
}) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }
  if (!mongoose.isValidObjectId(rewardId)) {
    throw new Error("Invalid rewardId");
  }
  const payoutDestination =
    destination === "wallet" ? "wallet" : "account";
  if (payoutDestination === "account" && !mongoose.isValidObjectId(accountId)) {
    throw new Error("Invalid accountId");
  }

  const session = await mongoose.startSession();
  let result = null;

  try {
    await session.withTransaction(async () => {
      let account = null;

      if (payoutDestination === "account") {
        account = await Account.findOne({
          _id: accountId,
          user_id: userId,
          status: "active",
        }).session(session);

        if (!account) {
          throw new Error("Account not found");
        }
        if (account.account_type !== "live") {
          throw new Error("Referral reward can be credited only to a live account");
        }
      }

      const reward = await ReferralReward.findOne({
        _id: rewardId,
        referrer_user: userId,
        status: "ELIGIBLE",
      }).session(session);

      if (!reward) {
        throw new Error("Referral reward is not eligible for payout");
      }

      const amount = Number(reward.reward_amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Invalid reward amount");
      }

      if (payoutDestination === "wallet") {
        /* ---------- credit user wallet ---------- */
        const walletUser = await User.findById(userId).session(session);
        if (!walletUser) {
          throw new Error("User not found");
        }

        const newWalletBalance =
          Number(walletUser.wallet_balance || 0) + amount;
        const newAvailable = Math.max(
          0,
          newWalletBalance - Number(walletUser.wallet_hold_balance || 0),
        );

        await User.updateOne(
          { _id: walletUser._id },
          { $set: { wallet_balance: newWalletBalance } },
          { session },
        );

        await WalletTransaction.create(
          [
            {
              user: userId,
              type: "CREDIT",
              amount,
              balanceAfter: newAvailable,
              status: "SUCCESS",
              referenceType: "REFERRAL",
              referenceId: reward._id,
              createdBy: userId,
              remark: "Referral payout credited to wallet",
            },
          ],
          { session },
        );

        await Referral.updateOne(
          { user_id: userId },
          { $inc: { total_earned: amount } },
          { session, upsert: true },
        );

        await Referral.updateOne(
          { user_id: reward.referred_user },
          { $set: { status: "CONFIRMED" } },
          { session },
        );

        reward.status = "APPROVED";
        reward.requested_account = null;
        reward.requested_at = new Date();
        reward.approved_at = new Date();
        reward.approved_by = userId;
        await reward.save({ session });

        result = {
          rewardId: reward._id,
          destination: "wallet",
          amount,
          walletBalance: newWalletBalance,
          walletAvailable: newAvailable,
          status: "APPROVED",
          message: "Referral payout credited to your wallet",
        };
        return;
      }

      /* ---------- credit account bonus (existing flow) ---------- */
      const nextBonus = Number(account.bonus_balance || 0) + amount;
      const nextGranted = Number(account.bonus_granted || 0) + amount;
      const nextEquity = Number(account.balance || 0) + nextBonus;

      await Account.updateOne(
        { _id: account._id },
        {
          $set: {
            bonus_balance: nextBonus,
            bonus_granted: nextGranted,
            equity: nextEquity,
          },
        },
        { session },
      );

      await Transaction.create(
        [
          {
            user: userId,
            account: account._id,
            type: "BONUS_CREDIT_IN",
            amount,
            balanceAfter: Number(account.balance || 0),
            equityAfter: nextEquity,
            status: "SUCCESS",
            referenceType: "SYSTEM",
            referenceId: reward._id,
            createdBy: userId,
            remark: "Referral payout credited as bonus",
          },
        ],
        { session },
      );

      await Referral.updateOne(
        { user_id: userId },
        {
          $inc: {
            total_earned: amount,
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
      reward.requested_account = accountId;
      reward.requested_at = new Date();
      reward.approved_at = new Date();
      reward.approved_by = userId;
      await reward.save({ session });

      result = {
        rewardId: reward._id,
        accountId: account._id,
        amount,
        bonusBalance: nextBonus,
        equity: nextEquity,
        status: "APPROVED",
        message: "Referral payout credited as bonus credit",
      };
    });
  } finally {
    session.endSession();
  }

  if (result?.accountId) {
    try {
      const acc = await Account.findById(result.accountId)
        .select("balance")
        .lean();
      if (acc) {
        publishAccountBalance(String(result.accountId), Number(acc.balance || 0));
      }
      // Reload account into engine so bonus_balance is applied.
      await EngineSync.syncAccount(String(result.accountId));
    } catch (err) {
      console.error(
        "[REFERRAL] EngineSync after payout failed",
        err?.message || err,
      );
    }
  }

  return result;
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

      // Credit as bonus / credit (not withdrawable cash balance).
      const nextBonus = Number(account.bonus_balance || 0) + amount;
      const nextGranted = Number(account.bonus_granted || 0) + amount;
      const newBalance = Number(account.balance || 0);
      const newEquity = newBalance + nextBonus;

      await Account.updateOne(
        { _id: account._id },
        {
          $set: {
            bonus_balance: nextBonus,
            bonus_granted: nextGranted,
            equity: newEquity,
          },
        },
        { session },
      );

      await Transaction.create(
        [
          {
            user: reward.referrer_user,
            account: account._id,
            type: "BONUS_CREDIT_IN",
            amount,
            balanceAfter: newBalance,
            equityAfter: newEquity,
            status: "SUCCESS",
            referenceType: "SYSTEM",
            referenceId: reward._id,
            createdBy: adminId,
            remark: "Referral reward approved (bonus credit)",
          },
        ],
        { session },
      );

      await Referral.updateOne(
        { user_id: reward.referrer_user },
        {
          $inc: {
            total_earned: amount,
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

  if (result?.accountId) {
    try {
      publishAccountBalance(String(result.accountId), Number(result.newBalance || 0));
      await EngineSync.syncAccount(String(result.accountId));
    } catch (err) {
      console.error(
        "[REFERRAL] EngineSync after admin approve failed",
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
  depositId = null,
  session = null,
}) {
  if (!referredUserId || !referredAccountId || !planId) return;

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
        ...(depositId ? { deposit_id: depositId } : {}),
        reward_amount: rewardAmount,
        status: "ELIGIBLE",
      },
    },
    { upsert: true, session },
  );
}

/**
 * Backfill: if referred users already opened live accounts with a plan reward
 * but no ReferralReward row exists yet, create ELIGIBLE rows for the referrer.
 */
export async function syncMissingReferralRewardsForReferrer(referrerUserId) {
  if (!mongoose.isValidObjectId(referrerUserId)) return;

  const directs = await Referral.find({ referred_by: referrerUserId })
    .select("user_id")
    .lean();

  for (const row of directs) {
    const referredUserId = row.user_id;
    if (!referredUserId) continue;

    const exists = await ReferralReward.exists({ referred_user: referredUserId });
    if (exists) continue;

    const liveAcc = await Account.findOne({
      user_id: referredUserId,
      account_type: "live",
      status: "active",
    })
      .sort({ createdAt: 1 })
      .select("_id account_plan_id")
      .lean();

    if (!liveAcc?.account_plan_id) continue;

    await createReferralRewardEligibility({
      referredUserId,
      referredAccountId: liveAcc._id,
      planId: liveAcc.account_plan_id,
    });
  }
}
