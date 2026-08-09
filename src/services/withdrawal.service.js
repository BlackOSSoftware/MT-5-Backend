import mongoose from "mongoose";
import Withdrawal from "../models/Withdrawal.model.js";
import Account from "../models/Account.model.js";
import Transaction from "../models/Transaction.model.js";
import User from "../models/User.model.js";
import Trade from "../models/Trade.model.js";
import EngineSync from "../trade-engine/EngineSync.js";
import { publishAccountBalance } from "../trade-engine/EngineSyncBus.js";
import { getEffectiveBonusPercentForAccount } from "./bonus.service.js";
import {
  getWithdrawableBalance,
} from "../utils/nonWithdrawable.util.js";

/* -------------------- HELPERS -------------------- */

const parsePagination = (query) => {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 10;

  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

const parseDateRange = (query) => {
  const from = typeof query.from === "string" ? new Date(query.from) : null;
  const to = typeof query.to === "string" ? new Date(query.to) : null;

  const fromValid = from instanceof Date && !Number.isNaN(from.getTime());
  const toValid = to instanceof Date && !Number.isNaN(to.getTime());

  return {
    from: fromValid ? from : null,
    to: toValid ? to : null,
  };
};

const buildFilter = ({ userId, query, isAdmin }) => {
  const filter = {};

  if (!isAdmin && userId) {
    filter.user = userId;
  }

  if (isAdmin && query.userId && mongoose.isValidObjectId(query.userId)) {
    filter.user = new mongoose.Types.ObjectId(query.userId);
  }

  if (query.accountId && mongoose.isValidObjectId(query.accountId)) {
    filter.account = new mongoose.Types.ObjectId(query.accountId);
  }

  if (query.status && typeof query.status === "string") {
    filter.status = query.status;
  }

  if (query.method && typeof query.method === "string") {
    filter.method = query.method;
  }

  const { from, to } = parseDateRange(query);

  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }

  return filter;
};

const validatePayout = ({ method, payout }) => {
  if (!method) {
    return { ok: false, message: "Withdrawal method is required" };
  }

  if (!payout || typeof payout !== "object") {
    return { ok: false, message: "Payout details are required" };
  }

  if (method === "UPI") {
    if (!payout.upi_id || typeof payout.upi_id !== "string") {
      return { ok: false, message: "UPI ID is required" };
    }
  }

  if (method === "BANK") {
    if (
      !payout.bank_name ||
      !payout.account_holder_name ||
      !payout.account_number
    ) {
      return { ok: false, message: "Complete bank details are required" };
    }
  }

  if (method === "CRYPTO") {
    if (!payout.crypto_network || !payout.crypto_address) {
      return { ok: false, message: "Crypto network & address are required" };
    }
  }

  return { ok: true, message: "OK" };
};

const computeBonusDeduction = ({
  amount,
  bonusBalance,
  bonusPercent,
}) => {
  const amt = Number(amount);
  const bal = Number(bonusBalance);
  const pct = Number(bonusPercent);

  if (!Number.isFinite(amt) || amt <= 0) return 0;
  if (!Number.isFinite(bal) || bal <= 0) return 0;
  if (!Number.isFinite(pct) || pct <= 0) return 0;

  const raw = (amt * pct) / 100;
  const safeRaw = Number(raw.toFixed(8));
  return Math.max(0, Math.min(bal, safeRaw));
};

const parseOptionalDateTime = (value, fieldName = "dateTime") => {
  if (value === undefined || value === null || value === "") return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return d;
};

/* -------------------- ADMIN: CREATE WITHDRAWAL (INSTANT) -------------------- */
/**
 * ADMIN: CREATE WITHDRAWAL
 * - No hold balance
 * - No pending state
 * - Must have no OPEN trades
 */
export const adminCreateWithdrawal = async ({
  adminId,
  ipAddress,
  payload,
}) => {
  const session = await mongoose.startSession();

  try {
    const { accountId, amount, method, payout, dateTime } = payload;

    if (!accountId || !mongoose.isValidObjectId(accountId)) {
      return { ok: false, statusCode: 400, message: "Invalid accountId" };
    }

    if (typeof amount !== "number" || amount < 1) {
      return { ok: false, statusCode: 400, message: "Invalid amount" };
    }

    if (!method || typeof method !== "string") {
      return { ok: false, statusCode: 400, message: "Method is required" };
    }

    const payoutCheck = validatePayout({ method, payout });
    if (!payoutCheck.ok) {
      return { ok: false, statusCode: 400, message: payoutCheck.message };
    }

    const importDateTime = parseOptionalDateTime(dateTime, "dateTime");

    let createdWithdrawal = null;
    let newBalanceAfter = null;
    let newBonusBalanceAfter = null;

    await session.withTransaction(async () => {
      /* =========================
         ACCOUNT CHECK
      ========================== */
      const account = await Account.findOne({
        _id: accountId,
        status: "active",
      }).session(session);

      if (!account) {
        throw new Error("Account not found or inactive");
      }

      if (account.account_type !== "live") {
        throw new Error("Withdrawals are allowed only for live accounts");
      }

      /* =========================
         OPEN TRADE CHECK (DB)
      ========================== */
      const openTrade = await Trade.exists({
        accountId: account._id,
        status: "OPEN",
      }).session(session);

      if (openTrade) {
        throw new Error("Please close all trades before withdrawal");
      }

      /* =========================
         BALANCE CHECK
      ========================== */
      const withdrawableBalance = getWithdrawableBalance(account);

      if (amount > withdrawableBalance) {
        throw new Error(
          `Only $${withdrawableBalance.toFixed(2)} is withdrawable in this account`,
        );
      }

      const bonusPercent = await getEffectiveBonusPercentForAccount(account);
      const bonusDeduct = computeBonusDeduction({
        amount,
        bonusBalance: account.bonus_balance,
        bonusPercent,
      });

      /* =========================
         DEDUCT BALANCE (NO HOLD)
      ========================== */
      account.balance = account.balance - amount;
      account.bonus_balance = Number(account.bonus_balance || 0) - bonusDeduct;
      if (account.bonus_balance < 0) account.bonus_balance = 0;
      account.equity = Number(account.balance) + Number(account.bonus_balance);
      newBalanceAfter = account.balance;
      newBonusBalanceAfter = account.bonus_balance;

      await account.save({ session });

      /* =========================
         CREATE WITHDRAWAL
      ========================== */
      const withdrawalDocs = await Withdrawal.create(
        [
          {
            user: account.user_id,
            account: account._id,
            amount,
            method,
            payout: {
              upi_id: payout?.upi_id || "",
              bank_name: payout?.bank_name || "",
              account_holder_name: payout?.account_holder_name || "",
              account_number: payout?.account_number || "",
              ifsc: payout?.ifsc || "",
              crypto_network: payout?.crypto_network || "",
              crypto_address: payout?.crypto_address || "",
            },
            status: "COMPLETED",
            actionBy: adminId,
            actionAt: importDateTime || new Date(),
            ipAddress: ipAddress || "",
            bonus_percent: Number(bonusPercent || 0),
            bonus_deducted: Number(bonusDeduct || 0),
            ...(importDateTime
              ? { createdAt: importDateTime, updatedAt: importDateTime }
              : {}),
          },
        ],
        { session },
      );

      createdWithdrawal = withdrawalDocs[0];

      /* =========================
         TRANSACTION LOG
      ========================== */
      await Transaction.create(
        [
          {
            user: account.user_id,
            account: account._id,
            type: "WITHDRAWAL",
            amount,
            balanceAfter: account.balance,
            equityAfter: account.equity,
            status: "SUCCESS",
            referenceType: "WITHDRAWAL",
            referenceId: createdWithdrawal._id,
            createdBy: adminId,
            remark: "Admin withdrawal",
            ...(importDateTime
              ? { createdAt: importDateTime, updatedAt: importDateTime }
              : {}),
          },
        ],
        { session },
      );

      if (bonusDeduct > 0) {
        await Transaction.create(
          [
            {
              user: account.user_id,
              account: account._id,
              type: "BONUS_CREDIT_OUT",
              amount: bonusDeduct,
              balanceAfter: account.balance,
              equityAfter: account.equity,
              status: "SUCCESS",
              referenceType: "WITHDRAWAL",
              referenceId: createdWithdrawal._id,
              createdBy: adminId,
              remark: "Bonus deducted on withdrawal",
              ...(importDateTime
                ? { createdAt: importDateTime, updatedAt: importDateTime }
                : {}),
            },
          ],
          { session },
        );
      }
    });

    // Sync engine: update balance (best-effort)
    try {
      if (newBalanceAfter !== null) {
        publishAccountBalance(
          String(payload.accountId),
          Number(newBalanceAfter),
          Number(newBonusBalanceAfter || 0),
        );
        await EngineSync.updateBalance(
          String(payload.accountId),
          Number(newBalanceAfter),
          {
            bonusBalance: Number(newBonusBalanceAfter || 0),
          },
        );
      }
    } catch (e) {
      console.error(
        "[ENGINE_SYNC] updateBalance failed (adminCreateWithdrawal)",
        e && e.message ? e.message : e,
      );
    }

    return {
      ok: true,
      statusCode: 201,
      message: "Admin withdrawal completed",
      data: createdWithdrawal,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 400,
      message: error instanceof Error ? error.message : "Something went wrong",
    };
  } finally {
    session.endSession();
  }
};

/* -------------------- USER: CREATE WITHDRAWAL -------------------- */
/**
 * USER: CREATE WITHDRAWAL REQUEST
 * ✅ KYC VERIFIED REQUIRED
 * ✅ DEDUCT BALANCE ON REQUEST
 * ✅ ADD HOLD_BALANCE ON REQUEST
 * ✅ ONLY 1 PENDING WITHDRAWAL ALLOWED PER ACCOUNT
 */
export const createWithdrawal = async ({ userId, ipAddress, payload }) => {
  const session = await mongoose.startSession();
  let engineAccountId = null;
  let engineNewBalance = null;
  let engineBonusBalance = null;

  try {
    const { accountId, amount, method, payout } = payload;

    if (!accountId || !mongoose.isValidObjectId(accountId)) {
      return { ok: false, statusCode: 400, message: "Invalid accountId" };
    }

    if (typeof amount !== "number" || amount < 1) {
      return { ok: false, statusCode: 400, message: "Invalid amount" };
    }

    if (!method || typeof method !== "string") {
      return { ok: false, statusCode: 400, message: "Method is required" };
    }

    const payoutCheck = validatePayout({ method, payout });
    if (!payoutCheck.ok) {
      return { ok: false, statusCode: 400, message: payoutCheck.message };
    }

    let createdWithdrawal = null;

    await session.withTransaction(async () => {
      /* =========================
         KYC CHECK
      ========================== */
      const user = await User.findById(userId)
        .select("kycStatus")
        .session(session);

      if (!user) {
        throw new Error("User not found");
      }

      if (user.kycStatus !== "VERIFIED") {
        throw new Error("KYC not verified. Please complete KYC to withdraw");
      }

      /* =========================
         ACCOUNT CHECK
      ========================== */
      const account = await Account.findOne({
        _id: accountId,
        user_id: userId,
      }).session(session);

      if (!account) {
        throw new Error("Account not found");
      }

      if (account.status !== "active") {
        throw new Error("Account is not active");
      }

      if (account.account_type !== "live") {
        throw new Error("Withdrawals are allowed only for live accounts");
      }

      if (account.first_deposit !== true) {
        throw new Error("Withdrawal allowed only after first approved deposit");
      }

      /* =========================
         PENDING WITHDRAW CHECK
      ========================== */
      const pending = await Withdrawal.findOne({
        user: userId,
        account: account._id,
        status: { $in: ["PENDING", "APPROVED", "PROCESSING"] },
      }).session(session);

      if (pending) {
        throw new Error("You already have a pending withdrawal request");
      }

      /* =========================
         OPEN TRADE CHECK (DB)
      ========================== */
      const openTrade = await Trade.exists({
        accountId: account._id,
        status: "OPEN",
      }).session(session);

      if (openTrade) {
        throw new Error(
          "Please close your all trade before processing any withdrawal",
        );
      }

      /* =========================
         BALANCE CHECK
      ========================== */
      const holdBalance =
        typeof account.hold_balance === "number" ? account.hold_balance : 0;

      const withdrawableBalance = getWithdrawableBalance(account);

      if (amount > withdrawableBalance) {
        throw new Error(
          `Only $${withdrawableBalance.toFixed(2)} is withdrawable in this account`,
        );
      }

      const bonusPercent = await getEffectiveBonusPercentForAccount(account);
      const bonusDeduct = computeBonusDeduction({
        amount,
        bonusBalance: account.bonus_balance,
        bonusPercent,
      });

      /* =========================
         LOCK FUNDS
      ========================== */
      account.balance = account.balance - amount;
      account.hold_balance = holdBalance + amount;
      account.bonus_balance = Number(account.bonus_balance || 0) - bonusDeduct;
      if (account.bonus_balance < 0) account.bonus_balance = 0;

      if (account.balance < 0) {
        throw new Error("Insufficient balance");
      }

      // equity = balance + bonus
      account.equity = Number(account.balance) + Number(account.bonus_balance);

      await account.save({ session });

      engineAccountId = String(account._id);
      engineNewBalance = Number(account.balance);
      engineBonusBalance = Number(account.bonus_balance);

      /* =========================
         CREATE WITHDRAWAL
      ========================== */
      const withdrawalDocs = await Withdrawal.create(
        [
          {
            user: userId,
            account: account._id,
            amount,
            method,
            payout: {
              upi_id: payout?.upi_id || "",
              bank_name: payout?.bank_name || "",
              account_holder_name: payout?.account_holder_name || "",
              account_number: payout?.account_number || "",
              ifsc: payout?.ifsc || "",
              crypto_network: payout?.crypto_network || "",
              crypto_address: payout?.crypto_address || "",
            },
            status: "PENDING",
            ipAddress: ipAddress || "",
            bonus_percent: Number(bonusPercent || 0),
            bonus_deducted: Number(bonusDeduct || 0),
          },
        ],
        { session },
      );

      createdWithdrawal = withdrawalDocs[0];

      /* =========================
         TRANSACTION LOG
      ========================== */
      await Transaction.create(
        [
          {
            user: userId,
            account: account._id,
            type: "WITHDRAWAL",
            amount,
            balanceAfter: account.balance,
            equityAfter: account.equity,
            status: "PENDING",
            referenceType: "WITHDRAWAL",
            referenceId: createdWithdrawal._id,
            createdBy: userId,
            remark:
              "Withdrawal request created (balance deducted and amount locked in hold)",
          },
        ],
        { session },
      );

      if (bonusDeduct > 0) {
        await Transaction.create(
          [
            {
              user: userId,
              account: account._id,
              type: "BONUS_CREDIT_OUT",
              amount: bonusDeduct,
              balanceAfter: account.balance,
              equityAfter: account.equity,
              status: "PENDING",
              referenceType: "WITHDRAWAL",
              referenceId: createdWithdrawal._id,
              createdBy: userId,
              remark: "Bonus deducted on withdrawal request",
            },
          ],
          { session },
        );
      }
    });

    // Sync engine after DB commit
    try {
      if (engineAccountId && Number.isFinite(engineNewBalance)) {
        publishAccountBalance(
          engineAccountId,
          engineNewBalance,
          engineBonusBalance,
        );
        await EngineSync.updateBalance(engineAccountId, engineNewBalance, {
          bonusBalance: engineBonusBalance,
        });
      }
    } catch (e) {
      console.error(
        "[ENGINE_SYNC] updateBalance failed (createWithdrawal)",
        e && e.message ? e.message : e,
      );
    }

    return {
      ok: true,
      statusCode: 201,
      message: "Withdrawal request created successfully",
      data: createdWithdrawal,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 400,
      message: error instanceof Error ? error.message : "Something went wrong",
    };
  } finally {
    session.endSession();
  }
};

/* -------------------- USER: LIST WITHDRAWALS -------------------- */

export const listUserWithdrawals = async ({ userId, query }) => {
  const { page, limit, skip } = parsePagination(query);

  const filter = buildFilter({ userId, query, isAdmin: false });

  const sortBy = typeof query.sortBy === "string" ? query.sortBy : "createdAt";
  const sortDir = query.sortDir === "asc" ? 1 : -1;

  const sort = {};
  sort[sortBy] = sortDir;

  const [items, total] = await Promise.all([
    Withdrawal.find(filter)
      .select("-payout.account_number")
      .populate("account", "account_number ")
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Withdrawal.countDocuments(filter),
  ]);

  return {
    ok: true,
    statusCode: 200,
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  };
};

/* -------------------- ADMIN: LIST ALL WITHDRAWALS -------------------- */

export const listAdminWithdrawals = async ({ query }) => {
  const { page, limit, skip } = parsePagination(query);

  const filter = buildFilter({ userId: null, query, isAdmin: true });

  const sortBy = typeof query.sortBy === "string" ? query.sortBy : "createdAt";
  const sortDir = query.sortDir === "asc" ? 1 : -1;

  const sort = {};
  sort[sortBy] = sortDir;

  const [items, total] = await Promise.all([
    Withdrawal.find(filter)
      .populate("user", "name email")
      .populate(
        "account",
        "account_number account_type balance hold_balance status",
      )
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Withdrawal.countDocuments(filter),
  ]);

  return {
    ok: true,
    statusCode: 200,
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    },
  };
};

/* -------------------- ADMIN: SEARCH WITHDRAWALS -------------------- */

export const adminSearchWithdrawals = async ({ query }) => {
  try {
    const { page, limit, skip } = parsePagination(query);

    const match = {};

    const userIdRaw = String(query.userId ?? query.user ?? "").trim();
    if (userIdRaw) {
      if (!mongoose.isValidObjectId(userIdRaw)) {
        return { ok: false, statusCode: 400, message: "Invalid userId" };
      }
      match.user = new mongoose.Types.ObjectId(userIdRaw);
    }

    const accountIdRaw = String(query.accountId ?? query.account ?? "").trim();
    if (accountIdRaw) {
      if (!mongoose.isValidObjectId(accountIdRaw)) {
        return { ok: false, statusCode: 400, message: "Invalid accountId" };
      }
      match.account = new mongoose.Types.ObjectId(accountIdRaw);
    }

    const statusRaw =
      typeof query.status === "string" ? query.status.trim().toUpperCase() : "";
    if (statusRaw) {
      const allowed = new Set([
        "PENDING",
        "APPROVED",
        "REJECTED",
        "PROCESSING",
        "COMPLETED",
        "FAILED",
      ]);

      if (!allowed.has(statusRaw)) {
        return {
          ok: false,
          statusCode: 400,
          message:
            "Invalid status. Allowed: PENDING, APPROVED, REJECTED, PROCESSING, COMPLETED, FAILED",
        };
      }

      match.status = statusRaw;
    }

    const methodRaw =
      typeof query.method === "string" ? query.method.trim().toUpperCase() : "";
    if (methodRaw) {
      const allowed = new Set(["UPI", "BANK", "CRYPTO"]);

      if (!allowed.has(methodRaw)) {
        return {
          ok: false,
          statusCode: 400,
          message: "Invalid method. Allowed: UPI, BANK, CRYPTO",
        };
      }

      match.method = methodRaw;
    }

    const fromRaw = String(query.fromDate ?? query.startDate ?? query.from ?? "")
      .trim();
    const toRaw = String(query.toDate ?? query.endDate ?? query.to ?? "").trim();

    const from = fromRaw ? new Date(fromRaw) : null;
    const to = toRaw ? new Date(toRaw) : null;

    const fromValid = from instanceof Date && !Number.isNaN(from.getTime());
    const toValid = to instanceof Date && !Number.isNaN(to.getTime());

    if (fromRaw && !fromValid) {
      return { ok: false, statusCode: 400, message: "Invalid fromDate" };
    }

    if (toRaw && !toValid) {
      return { ok: false, statusCode: 400, message: "Invalid toDate" };
    }

    if (fromValid || toValid) {
      match.createdAt = {};
      if (fromValid) match.createdAt.$gte = from;
      if (toValid) match.createdAt.$lte = to;
    }

    const sortByRaw =
      typeof query.sortBy === "string" ? query.sortBy.trim() : "";
    const sortBy = ["createdAt", "updatedAt", "actionAt", "amount"].includes(
      sortByRaw,
    )
      ? sortByRaw
      : "createdAt";

    const sortDirRaw =
      typeof query.sortDir === "string" ? query.sortDir.trim().toLowerCase() : "";
    const sortDir = sortDirRaw === "asc" ? 1 : -1;

    const q = String(query.q || "").trim();
    const escapeRegex = (s) =>
      String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const qMatch = [];
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");

      qMatch.push(
        { "user.name": rx },
        { "user.email": rx },
        { "user.phone": rx },
        { "account.account_number": rx },
        { "account.plan_name": rx },
      );

      if (mongoose.isValidObjectId(q)) {
        qMatch.push({ _id: new mongoose.Types.ObjectId(q) });
      }
    }

    const pipeline = [
      { $match: match },
      {
        $lookup: {
          from: User.collection.name,
          localField: "user",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: Account.collection.name,
          localField: "account",
          foreignField: "_id",
          as: "account",
        },
      },
      { $unwind: { path: "$account", preserveNullAndEmptyArrays: true } },
      ...(qMatch.length > 0 ? [{ $match: { $or: qMatch } }] : []),
      { $sort: { [sortBy]: sortDir, _id: sortDir } },
      {
        $facet: {
          items: [
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                _id: 1,
                user: {
                  _id: "$user._id",
                  name: "$user.name",
                  email: "$user.email",
                  phone: "$user.phone",
                  userType: "$user.userType",
                  isMailVerified: "$user.isMailVerified",
                  kycStatus: "$user.kycStatus",
                },
                account: {
                  _id: "$account._id",
                  account_number: "$account.account_number",
                  account_type: "$account.account_type",
                  plan_name: "$account.plan_name",
                  balance: "$account.balance",
                  hold_balance: "$account.hold_balance",
                  status: "$account.status",
                },
                amount: 1,
                bonus_percent: 1,
                bonus_deducted: 1,
                method: 1,
                payout: 1,
                status: 1,
                rejectionReason: 1,
                actionBy: 1,
                actionAt: 1,
                ipAddress: 1,
                createdAt: 1,
                updatedAt: 1,
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      },
    ];

    const result = await Withdrawal.aggregate(pipeline).allowDiskUse(true);
    const items = result?.[0]?.items || [];
    const total = result?.[0]?.total?.[0]?.count || 0;

    return {
      ok: true,
      statusCode: 200,
      data: {
        items,
        pagination: {
          page,
          limit,
          total,
          totalPages: total === 0 ? 0 : Math.ceil(total / limit),
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 400,
      message: error instanceof Error ? error.message : "Something went wrong",
    };
  }
};

/* -------------------- ADMIN: APPROVE WITHDRAWAL -------------------- */
/**
 * ADMIN: APPROVE WITHDRAWAL
 * ✅ ONLY HOLD_BALANCE WILL DECREASE
 * ✅ BALANCE ALREADY DEDUCTED AT REQUEST TIME
 */
export const adminApproveWithdrawal = async ({ adminId, withdrawalId }) => {
  const session = await mongoose.startSession();

  try {
    if (!mongoose.isValidObjectId(withdrawalId)) {
      return { ok: false, statusCode: 400, message: "Invalid withdrawalId" };
    }

    let updatedWithdrawal = null;

    await session.withTransaction(async () => {
      const withdrawal =
        await Withdrawal.findById(withdrawalId).session(session);

      if (!withdrawal) {
        throw new Error("Withdrawal not found");
      }

      if (withdrawal.status !== "PENDING") {
        throw new Error("Only pending withdrawals can be approved");
      }

      const account = await Account.findOne({
        _id: withdrawal.account,
        user_id: withdrawal.user,
      }).session(session);

      if (!account) {
        throw new Error("Account not found for this withdrawal");
      }

      if (account.status !== "active") {
        throw new Error("Account is not active");
      }

      const holdBalance =
        typeof account.hold_balance === "number" ? account.hold_balance : 0;

      if (withdrawal.amount > holdBalance) {
        throw new Error("Hold balance mismatch. Cannot approve withdrawal");
      }

      // ✅ payout success, remove from hold
      account.hold_balance = holdBalance - withdrawal.amount;

      if (account.hold_balance < 0) {
        account.hold_balance = 0;
      }

      account.equity = Number(account.balance) + Number(account.bonus_balance || 0);

      await account.save({ session });

      withdrawal.status = "COMPLETED";
      withdrawal.actionBy = adminId;
      withdrawal.actionAt = new Date();
      withdrawal.rejectionReason = "";

      updatedWithdrawal = await withdrawal.save({ session });

      await Transaction.findOneAndUpdate(
        {
          referenceType: "WITHDRAWAL",
          referenceId: withdrawal._id,
          user: withdrawal.user,
          account: withdrawal.account,
        },
        {
          $set: {
            status: "SUCCESS",
            balanceAfter: account.balance,
            remark: "Withdrawal approved and completed",
          },
        },
        { session },
      );

      await Transaction.findOneAndUpdate(
        {
          referenceType: "WITHDRAWAL",
          referenceId: withdrawal._id,
          user: withdrawal.user,
          account: withdrawal.account,
          type: "BONUS_CREDIT_OUT",
        },
        {
          $set: {
            status: "SUCCESS",
            balanceAfter: account.balance,
            equityAfter: account.equity,
            remark: "Bonus deducted on withdrawal approval",
          },
        },
        { session },
      );
    });

    return {
      ok: true,
      statusCode: 200,
      message: "Withdrawal approved successfully",
      data: updatedWithdrawal,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 400,
      message: error instanceof Error ? error.message : "Something went wrong",
    };
  } finally {
    session.endSession();
  }
};

/* -------------------- ADMIN: REJECT WITHDRAWAL -------------------- */
/**
 * ADMIN: REJECT WITHDRAWAL
 * ✅ REFUND BALANCE BACK
 * ✅ REMOVE FROM HOLD_BALANCE
 */
export const adminRejectWithdrawal = async ({
  adminId,
  withdrawalId,
  rejectionReason,
}) => {
  const session = await mongoose.startSession();
  let engineAccountId = null;
  let engineNewBalance = null;
  let engineBonusBalance = null;

  try {
    if (!mongoose.isValidObjectId(withdrawalId)) {
      return { ok: false, statusCode: 400, message: "Invalid withdrawalId" };
    }

    const reason =
      typeof rejectionReason === "string" && rejectionReason.trim().length > 0
        ? rejectionReason.trim()
        : "Rejected by admin";

    let updatedWithdrawal = null;

    await session.withTransaction(async () => {
      const withdrawal =
        await Withdrawal.findById(withdrawalId).session(session);

      if (!withdrawal) {
        throw new Error("Withdrawal not found");
      }

      if (withdrawal.status !== "PENDING") {
        throw new Error("Only pending withdrawals can be rejected");
      }

      const account = await Account.findOne({
        _id: withdrawal.account,
        user_id: withdrawal.user,
      }).session(session);

      if (!account) {
        throw new Error("Account not found for this withdrawal");
      }

      if (account.status !== "active") {
        throw new Error("Account is not active");
      }

      const holdBalance =
        typeof account.hold_balance === "number" ? account.hold_balance : 0;

      if (withdrawal.amount > holdBalance) {
        throw new Error("Hold balance mismatch. Cannot reject withdrawal");
      }

      // ✅ refund money back + remove from hold
      account.balance = account.balance + withdrawal.amount;
      account.hold_balance = holdBalance - withdrawal.amount;

      const bonusRefund = Number(withdrawal.bonus_deducted || 0);
      if (bonusRefund > 0) {
        const rawBonus =
          Number(account.bonus_balance || 0) + Number(bonusRefund || 0);
        const granted = Number(account.bonus_granted || 0);
        account.bonus_balance =
          granted > 0 ? Math.min(rawBonus, granted) : rawBonus;
      }

      if (account.hold_balance < 0) {
        account.hold_balance = 0;
      }

      account.equity = Number(account.balance) + Number(account.bonus_balance || 0);

      await account.save({ session });

      engineAccountId = String(account._id);
      engineNewBalance = Number(account.balance);
      engineBonusBalance = Number(account.bonus_balance || 0);

      withdrawal.status = "REJECTED";
      withdrawal.rejectionReason = reason;
      withdrawal.actionBy = adminId;
      withdrawal.actionAt = new Date();

      updatedWithdrawal = await withdrawal.save({ session });

      await Transaction.findOneAndUpdate(
        {
          referenceType: "WITHDRAWAL",
          referenceId: withdrawal._id,
          user: withdrawal.user,
          account: withdrawal.account,
        },
        {
          $set: {
            status: "FAILED",
            balanceAfter: account.balance,
            remark: `Withdrawal rejected: ${reason}`,
          },
        },
        { session },
      );

      await Transaction.findOneAndUpdate(
        {
          referenceType: "WITHDRAWAL",
          referenceId: withdrawal._id,
          user: withdrawal.user,
          account: withdrawal.account,
          type: "BONUS_CREDIT_OUT",
        },
        {
          $set: {
            status: "FAILED",
            balanceAfter: account.balance,
            equityAfter: account.equity,
            remark: `Bonus refund on withdrawal rejection`,
          },
        },
        { session },
      );

      if (bonusRefund > 0) {
        await Transaction.create(
          [
            {
              user: withdrawal.user,
              account: withdrawal.account,
              type: "BONUS_CREDIT_IN",
              amount: bonusRefund,
              balanceAfter: account.balance,
              equityAfter: account.equity,
              status: "SUCCESS",
              referenceType: "WITHDRAWAL",
              referenceId: withdrawal._id,
              createdBy: adminId,
              remark: "Bonus refunded on withdrawal rejection",
            },
          ],
          { session },
        );
      }
    });

    // Sync engine after DB commit
    try {
      if (engineAccountId && Number.isFinite(engineNewBalance)) {
        publishAccountBalance(
          engineAccountId,
          engineNewBalance,
          engineBonusBalance,
        );
        await EngineSync.updateBalance(engineAccountId, engineNewBalance, {
          bonusBalance: engineBonusBalance,
        });
      }
    } catch (e) {
      console.error(
        "[ENGINE_SYNC] updateBalance failed (adminRejectWithdrawal)",
        e && e.message ? e.message : e,
      );
    }

    return {
      ok: true,
      statusCode: 200,
      message: "Withdrawal rejected successfully",
      data: updatedWithdrawal,
    };
  } catch (error) {
    return {
      ok: false,
      statusCode: 400,
      message: error instanceof Error ? error.message : "Something went wrong",
    };
  } finally {
    session.endSession();
  }
};
