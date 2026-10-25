import mongoose from "mongoose";
import Transaction from '../models/Transaction.model.js';

/**
 * USER TRANSACTION HISTORY (WITH DATE FILTER)
 */
export async function getUserTransactionHistoryService({
  userId,
  accountId,
  page,
  limit,
  type,
  status,
  fromDate,
  toDate
}) {
  const skip = (page - 1) * limit;

  const filter = {
    user: userId,
    $nor: [
      {
        type: "ADJUSTMENT",
        referenceType: "SYSTEM",
      },
    ],
  };

  // Optional filters
  if (accountId) filter.account = accountId;
  if (type) filter.type = type;
  if (status) filter.status = status;

  // Date range filter (createdAt is indexed)
  if (fromDate || toDate) {
    filter.createdAt = {};

    if (fromDate) {
      filter.createdAt.$gte = new Date(fromDate);
    }

    if (toDate) {
      // include full day
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  const transactionsRaw = await Transaction.find(
    filter,
    {
      type: 1,
      amount: 1,
      balanceAfter: 1,
      equityAfter: 1,
      status: 1,
      account: 1,
      referenceType: 1,
      referenceId: 1,
      remark: 1,
      createdAt: 1
    }
  )
    .populate({ path: "account", select: "account_number" })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const transactions = transactionsRaw.map((tx) => {
    const isPopulatedAccount = tx.account && typeof tx.account === "object";
    const accountIdValue = isPopulatedAccount ? tx.account._id : tx.account;
    const accountNumber = isPopulatedAccount ? tx.account.account_number : null;

    return {
      ...tx,
      account: accountIdValue,
      accountId: accountIdValue,
      accountNumber
    };
  });

  const total = await Transaction.countDocuments(filter);

  return {
    data: transactions,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * ADMIN USER TRANSACTION HISTORY (WITH FILTERS + DATE + PAGINATION)
 */
export async function getAdminUserTransactionHistoryService({
  userId,
  accountId,
  page,
  limit,
  type,
  status,
  referenceType,
  referenceId,
  fromDate,
  toDate,
  sortBy,
  sortDir
}) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  if (accountId && !mongoose.isValidObjectId(accountId)) {
    throw new Error("Invalid accountId");
  }

  if (referenceId && !mongoose.isValidObjectId(referenceId)) {
    throw new Error("Invalid referenceId");
  }

  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
  const skip = (safePage - 1) * safeLimit;

  const filter = {
    user: new mongoose.Types.ObjectId(userId)
  };

  if (accountId) filter.account = new mongoose.Types.ObjectId(accountId);
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (referenceType) filter.referenceType = referenceType;
  if (referenceId) filter.referenceId = new mongoose.Types.ObjectId(referenceId);

  if (fromDate || toDate) {
    filter.createdAt = {};

    if (fromDate) {
      filter.createdAt.$gte = new Date(fromDate);
    }

    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  const allowedSort = new Set(["createdAt", "amount", "status", "type"]);
  const sortField = allowedSort.has(sortBy) ? sortBy : "createdAt";
  const sortDirection = sortDir === "asc" ? 1 : -1;

  const sort = {};
  sort[sortField] = sortDirection;

  const [transactions, total, totalAmountAgg] = await Promise.all([
    Transaction.find(
      filter,
      {
        type: 1,
        amount: 1,
        balanceAfter: 1,
        equityAfter: 1,
        status: 1,
        account: 1,
        referenceType: 1,
        referenceId: 1,
        remark: 1,
        createdAt: 1
      }
    )
      .sort(sort)
      .skip(skip)
      .limit(safeLimit)
      .lean(),

    Transaction.countDocuments(filter),

    Transaction.aggregate([
      { $match: filter },
      { $group: { _id: null, sum: { $sum: "$amount" } } }
    ])
  ]);

  const totalAmount = totalAmountAgg?.[0]?.sum ?? 0;

  return {
    data: transactions,
    summary: {
      totalCount: total,
      totalAmount
    },
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit)
    }
  };
}

function isValidYmd(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getTodayYmd(timeZone) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    // fallback to local date
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

function getDateRangeForYmd({ fromYmd, toYmd, timeZone }) {
  // For IST (Asia/Kolkata), offset is always +05:30 (no DST).
  const tz = String(timeZone || "").trim();
  const isIst =
    tz === "Asia/Kolkata" ||
    tz === "Asia/Calcutta" ||
    tz.toLowerCase().includes("kolkata");

  if (!isValidYmd(fromYmd) || !isValidYmd(toYmd)) {
    throw new Error("Invalid date format. Use YYYY-MM-DD");
  }

  if (isIst) {
    const start = new Date(`${fromYmd}T00:00:00.000+05:30`);
    const end = new Date(`${toYmd}T23:59:59.999+05:30`);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Invalid date range");
    }

    return { start, end };
  }

  // fallback: server-local timezone
  const start = new Date(fromYmd);
  const end = new Date(toYmd);
  end.setHours(23, 59, 59, 999);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range");
  }

  return { start, end };
}

/**
 * ADMIN: LIST SWAP DEDUCTIONS (GLOBAL)
 * - Defaults to today's transactions (IST via SWAP_CRON_TZ)
 * - Supports pagination, date filter, and search by user/account
 */
export async function adminListSwapDeductionsService({ query = {} }) {
  const q = String(query.q || "").trim();

  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 20;
  const skip = (page - 1) * limit;

  const timeZone = process.env.SWAP_CRON_TZ || process.env.TZ || "Asia/Kolkata";

  const fromDateRaw =
    typeof query.fromDate === "string" ? query.fromDate.trim() : "";
  const toDateRaw = typeof query.toDate === "string" ? query.toDate.trim() : "";

  const todayYmd = getTodayYmd(timeZone);
  const fromYmd = fromDateRaw || todayYmd;
  const toYmd = toDateRaw || todayYmd;

  const { start, end } = getDateRangeForYmd({
    fromYmd,
    toYmd,
    timeZone,
  });

  const statusRaw = typeof query.status === "string" ? query.status.trim() : "";
  const status = statusRaw ? statusRaw.toUpperCase() : "SUCCESS";
  if (!["PENDING", "SUCCESS", "FAILED"].includes(status)) {
    throw new Error("Invalid status. Allowed: PENDING, SUCCESS, FAILED");
  }

  const directionRaw =
    typeof query.direction === "string" ? query.direction.trim().toLowerCase() : "";
  const direction = ["charged", "credited", "all"].includes(directionRaw)
    ? directionRaw
    : "charged";

  const match = {
    type: "SWAP",
    status,
    createdAt: { $gte: start, $lte: end },
  };

  if (direction === "charged") {
    match.remark = { $regex: /^Overnight swap charged/i };
  } else if (direction === "credited") {
    match.remark = { $regex: /^Overnight swap credited/i };
  }

  if (query.userId !== undefined) {
    if (!mongoose.isValidObjectId(query.userId)) {
      throw new Error("Invalid userId");
    }
    match.user = new mongoose.Types.ObjectId(query.userId);
  } else if (query.brokerId) {
    const { applyBrokerUserIdMatch } = await import("../utils/brokerScope.js");
    await applyBrokerUserIdMatch(match, query.brokerId, "user");
  }

  if (query.accountId !== undefined) {
    if (!mongoose.isValidObjectId(query.accountId)) {
      throw new Error("Invalid accountId");
    }
    match.account = new mongoose.Types.ObjectId(query.accountId);
  }

  const sortByRaw =
    typeof query.sortBy === "string" ? query.sortBy.trim() : "";
  const sortDirRaw =
    typeof query.sortDir === "string" ? query.sortDir.trim().toLowerCase() : "";
  const sortDir = sortDirRaw === "asc" ? 1 : -1;

  const allowedSort = new Set(["createdAt", "amount", "balanceAfter", "status"]);
  const sortBy = allowedSort.has(sortByRaw) ? sortByRaw : "createdAt";

  const searchRegex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: "users",
        localField: "user",
        foreignField: "_id",
        as: "userDoc",
      },
    },
    { $unwind: { path: "$userDoc", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: "accounts",
        localField: "account",
        foreignField: "_id",
        as: "accountDoc",
      },
    },
    { $unwind: { path: "$accountDoc", preserveNullAndEmptyArrays: true } },
    ...(searchRegex
      ? [
          {
            $match: {
              $or: [
                { "userDoc.name": { $regex: searchRegex } },
                { "userDoc.email": { $regex: searchRegex } },
                { "userDoc.phone": { $regex: searchRegex } },
                { "accountDoc.account_number": { $regex: searchRegex } },
              ],
            },
          },
        ]
      : []),
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
                _id: "$userDoc._id",
                name: "$userDoc.name",
                email: "$userDoc.email",
                phone: "$userDoc.phone",
                userType: "$userDoc.userType",
              },
              account: {
                _id: "$accountDoc._id",
                account_number: "$accountDoc.account_number",
                account_type: "$accountDoc.account_type",
              },
              type: 1,
              amount: 1,
              balanceAfter: 1,
              equityAfter: 1,
              status: 1,
              referenceType: 1,
              referenceId: 1,
              remark: 1,
              createdAt: 1,
            },
          },
        ],
        meta: [
          {
            $group: {
              _id: null,
              totalCount: { $sum: 1 },
              totalAmount: { $sum: "$amount" },
            },
          },
        ],
      },
    },
    {
      $addFields: {
        summary: {
          totalCount: {
            $ifNull: [{ $arrayElemAt: ["$meta.totalCount", 0] }, 0],
          },
          totalAmount: {
            $ifNull: [{ $arrayElemAt: ["$meta.totalAmount", 0] }, 0],
          },
        },
      },
    },
    { $project: { items: 1, summary: 1 } },
  ];

  const agg = await Transaction.aggregate(pipeline).allowDiskUse(true);
  const row = agg?.[0] || { items: [], summary: { totalCount: 0, totalAmount: 0 } };

  const total = Number(row?.summary?.totalCount) || 0;

  return {
    data: Array.isArray(row.items) ? row.items : [],
    summary: {
      totalCount: total,
      totalAmount: Number(row?.summary?.totalAmount) || 0,
      fromDate: fromYmd,
      toDate: toYmd,
      direction,
      timeZone,
    },
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}
