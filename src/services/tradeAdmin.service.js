import Trade from "../models/Trade.model.js";
import PendingOrder from "../models/PendingOrder.model.js";
import User from "../models/User.model.js";
import Account from "../models/Account.model.js";
import mongoose from "mongoose";
import Brokerage from "../models/Brokerage.model.js";
import {
  applyBrokerUserIdMatch,
  getBrokerUserIds,
} from "../utils/brokerScope.js";

const TRADE_SIDES = new Set(["BUY", "SELL"]);
const TRADE_ORDER_TYPES = new Set([
  "MARKET",
  "BUY_LIMIT",
  "SELL_LIMIT",
  "BUY_STOP",
  "SELL_STOP",
]);
const TRADE_ORDER_KIND_TO_TYPES = {
  MARKET: ["MARKET"],
  LIMIT: ["BUY_LIMIT", "SELL_LIMIT"],
  STOP: ["BUY_STOP", "SELL_STOP"],
};

const PENDING_ORDER_TYPES = new Set([
  "BUY_LIMIT",
  "SELL_LIMIT",
  "BUY_STOP",
  "SELL_STOP",
]);
const PENDING_ORDER_KIND_TO_TYPES = {
  LIMIT: ["BUY_LIMIT", "SELL_LIMIT"],
  STOP: ["BUY_STOP", "SELL_STOP"],
};
const PENDING_ORDER_HISTORY_STATUSES = [
  "EXECUTED",
  "CANCELLED",
  "EXPIRED",
  "FAILED",
];
const PENDING_ORDER_REJECTED_STATUSES = ["CANCELLED", "EXPIRED", "FAILED"];

const toObjectIdList = (values) => {
  const ids = [];
  const seen = new Set();
  for (const value of values) {
    const raw = String(value ?? "").trim();
    if (!raw || seen.has(raw) || !mongoose.isValidObjectId(raw)) continue;
    seen.add(raw);
    ids.push(new mongoose.Types.ObjectId(raw));
  }
  return ids;
};

/**
 * Attach human-readable labels so admin UI does not show raw Mongo ObjectIds.
 * Keeps original userId/accountId for filters, routing, and actions.
 */
const attachUserAccountLabels = async (
  items,
  { userKey = "userId", accountKey = "accountId" } = {}
) => {
  if (!Array.isArray(items) || items.length === 0) return items;

  const userIds = toObjectIdList(items.map((item) => item?.[userKey]));
  const accountIds = toObjectIdList(items.map((item) => item?.[accountKey]));

  const [users, accounts] = await Promise.all([
    userIds.length
      ? User.find({ _id: { $in: userIds } }).select("name email").lean()
      : [],
    accountIds.length
      ? Account.find({ _id: { $in: accountIds } })
          .select("account_number")
          .lean()
      : [],
  ]);

  const userMap = new Map(
    users.map((u) => [String(u._id), { name: u.name || "", email: u.email || "" }])
  );
  const accountMap = new Map(
    accounts.map((a) => [String(a._id), a.account_number || ""])
  );

  return items.map((item) => {
    const userId = String(item?.[userKey] ?? "");
    const accountId = String(item?.[accountKey] ?? "");
    const user = userMap.get(userId);
    const accountNumber = accountMap.get(accountId) || "";

    return {
      ...item,
      userName: user?.name || "",
      userEmail: user?.email || "",
      accountNumber,
      // camel + snake for mixed admin payloads
      account_number: accountNumber,
      user_name: user?.name || "",
      user_email: user?.email || "",
    };
  });
};

export const getTradeAdminSummaryService = async (brokerId = null) => {
  const brokerUserIds = await getBrokerUserIds(brokerId);
  const tradeMatch = { status: "OPEN", isDeleted: { $ne: true } };
  const pendingMatch = { status: "PENDING", isDeleted: { $ne: true } };
  const userMatch = {};

  if (brokerUserIds !== null) {
    tradeMatch.userId = { $in: brokerUserIds };
    pendingMatch.userId = { $in: brokerUserIds };
    userMatch._id = { $in: brokerUserIds };
  }

  const [activePositions, pendingOrders, activeUsers, activeTradingAccountIds] =
    await Promise.all([
      Trade.countDocuments(tradeMatch),
      PendingOrder.countDocuments(pendingMatch),
      User.countDocuments(userMatch),
      Trade.distinct("accountId", tradeMatch),
    ]);

  return {
    activePositions,
    activePendingOrders: pendingOrders,
    activeUsers,
    activeTradingAccounts: Array.isArray(activeTradingAccountIds)
      ? activeTradingAccountIds.length
      : 0
  };
};

export const adminListUsersFundsService = async (query = {}) => {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const skip = (page - 1) * limit;

  const escapeRegex = (s) =>
    String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const match = {};

  if (query.brokerId) {
    match.brokerId = query.brokerId;
  }

  if (typeof query.userId === "string" && query.userId.trim()) {
    if (!mongoose.isValidObjectId(query.userId)) {
      throw new Error("Invalid userId");
    }
    match._id = new mongoose.Types.ObjectId(query.userId);
  }

  const q = String(query.q || "").trim();
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    match.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }

  if (typeof query.userType === "string" && query.userType.trim()) {
    const userType = query.userType.trim().toUpperCase();
    if (!["USER", "ADMIN"].includes(userType)) {
      throw new Error("Invalid userType. Allowed: USER, ADMIN");
    }
    match.userType = userType;
  }

  if (typeof query.isMailVerified === "string") {
    if (query.isMailVerified === "true") match.isMailVerified = true;
    if (query.isMailVerified === "false") match.isMailVerified = false;
  }

  if (typeof query.kycStatus === "string" && query.kycStatus.trim()) {
    const kycStatus = query.kycStatus.trim().toUpperCase();
    if (!["NOT_STARTED", "PENDING", "VERIFIED", "REJECTED"].includes(kycStatus)) {
      throw new Error("Invalid kycStatus");
    }
    match.kycStatus = kycStatus;
  }

  const sortDirRaw =
    typeof query.sortDir === "string" ? query.sortDir.trim().toLowerCase() : "";
  const sortDir = sortDirRaw === "asc" ? 1 : -1;

  const sortByRaw =
    typeof query.sortBy === "string" ? query.sortBy.trim() : "";
  const sortBy = ["createdAt", "updatedAt", "name", "email"].includes(sortByRaw)
    ? sortByRaw
    : "createdAt";

  const accountTypeRaw = String(query.account_type ?? query.accountType ?? "")
    .trim()
    .toLowerCase();
  const statusRaw = String(query.status ?? query.accountStatus ?? "")
    .trim()
    .toLowerCase();
  const currencyRaw = String(query.currency || "").trim();

  const accountMatch = {
    $expr: { $eq: ["$user_id", "$$userId"] },
  };

  if (accountTypeRaw) {
    if (!["demo", "live"].includes(accountTypeRaw)) {
      throw new Error("Invalid accountType (demo|live)");
    }
    accountMatch.account_type = accountTypeRaw;
  }

  if (statusRaw) {
    if (!["active", "disabled"].includes(statusRaw)) {
      throw new Error("Invalid status (active|disabled)");
    }
    accountMatch.status = statusRaw;
  }

  if (currencyRaw) {
    accountMatch.currency = currencyRaw.toUpperCase();
  }

  const pipeline = [
    { $match: match },
    { $sort: { [sortBy]: sortDir, _id: sortDir } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $lookup: {
              from: Account.collection.name,
              let: { userId: "$_id" },
              pipeline: [
                { $match: accountMatch },
                {
                  $group: {
                    _id: null,
                    accountsCount: { $sum: 1 },
                    totalBalance: { $sum: "$balance" },
                    totalHoldBalance: { $sum: "$hold_balance" },
                    totalEquity: { $sum: "$equity" },
                  },
                },
                {
                  $project: {
                    _id: 0,
                    accountsCount: 1,
                    totalBalance: 1,
                    totalHoldBalance: 1,
                    totalEquity: 1,
                    totalFreeBalance: {
                      $subtract: ["$totalBalance", "$totalHoldBalance"],
                    },
                  },
                },
              ],
              as: "funds",
            },
          },
          {
            $addFields: {
              funds: {
                $ifNull: [
                  { $arrayElemAt: ["$funds", 0] },
                  {
                    accountsCount: 0,
                    totalBalance: 0,
                    totalHoldBalance: 0,
                    totalFreeBalance: 0,
                    totalEquity: 0,
                  },
                ],
              },
            },
          },
          {
            $project: {
              _id: 1,
              name: 1,
              email: 1,
              phone: 1,
              userType: 1,
              isMailVerified: 1,
              kycStatus: 1,
              createdAt: 1,
              updatedAt: 1,
              funds: 1,
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
      },
    },
    { $project: { items: 1, total: 1 } },
  ];

  const agg = await User.aggregate(pipeline).allowDiskUse(true);
  const row = agg?.[0] || { items: [], total: 0 };
  const totalRaw = Number(row.total);
  const total = Number.isFinite(totalRaw) ? totalRaw : 0;

  return {
    items: Array.isArray(row.items) ? row.items : [],
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
};

export const adminListClosedTradesService = async (query = {}) => {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const skip = (page - 1) * limit;

  const match = {
    status: "CLOSED",
    isDeleted: { $ne: true },
  };

  if (query.userId !== undefined) {
    if (!mongoose.isValidObjectId(query.userId)) {
      throw new Error("Invalid userId");
    }
    match.userId = new mongoose.Types.ObjectId(query.userId);
  }

  if (query.accountId !== undefined) {
    if (!mongoose.isValidObjectId(query.accountId)) {
      throw new Error("Invalid accountId");
    }
    match.accountId = new mongoose.Types.ObjectId(query.accountId);
  }

  if (typeof query.positionId === "string" && query.positionId.trim()) {
    match.positionId = query.positionId.trim();
  }

  if (typeof query.symbol === "string" && query.symbol.trim()) {
    match.symbol = query.symbol.trim().toUpperCase();
  }

  if (typeof query.side === "string" && query.side.trim()) {
    const side = query.side.trim().toUpperCase();
    if (!TRADE_SIDES.has(side)) {
      throw new Error("Invalid side. Allowed: BUY, SELL");
    }
    match.side = side;
  }

  if (typeof query.orderType === "string" && query.orderType.trim()) {
    const orderType = query.orderType.trim().toUpperCase();
    if (!TRADE_ORDER_TYPES.has(orderType)) {
      throw new Error(
        "Invalid orderType. Allowed: MARKET, BUY_LIMIT, SELL_LIMIT, BUY_STOP, SELL_STOP",
      );
    }
    match.orderType = orderType;
  } else if (typeof query.orderKind === "string" && query.orderKind.trim()) {
    const orderKind = query.orderKind.trim().toUpperCase();
    const mappedTypes = TRADE_ORDER_KIND_TO_TYPES[orderKind];
    if (!mappedTypes) {
      throw new Error("Invalid orderKind. Allowed: MARKET, LIMIT, STOP");
    }
    match.orderType = { $in: mappedTypes };
  }

  if (query.brokerId) {
    await applyBrokerUserIdMatch(match, query.brokerId, "userId");
  }

  const timeFieldRaw =
    typeof query.timeField === "string" ? query.timeField.trim() : "";
  const timeField = ["openTime", "closeTime", "createdAt"].includes(timeFieldRaw)
    ? timeFieldRaw
    : "closeTime";

  const from = typeof query.from === "string" ? new Date(query.from) : null;
  const to = typeof query.to === "string" ? new Date(query.to) : null;
  const fromValid = from instanceof Date && !Number.isNaN(from.getTime());
  const toValid = to instanceof Date && !Number.isNaN(to.getTime());

  if (query.from && !fromValid) {
    throw new Error("Invalid from date");
  }
  if (query.to && !toValid) {
    throw new Error("Invalid to date");
  }

  if (fromValid || toValid) {
    match[timeField] = {};
    if (fromValid) match[timeField].$gte = from;
    if (toValid) match[timeField].$lte = to;
  }

  const sortDirRaw =
    typeof query.sortDir === "string" ? query.sortDir.trim().toLowerCase() : "";
  const sortDir = sortDirRaw === "asc" ? 1 : -1;
  const sortByRaw =
    typeof query.sortBy === "string" ? query.sortBy.trim() : "";
  const sortBy = ["closeTime", "openTime", "createdAt"].includes(sortByRaw)
    ? sortByRaw
    : timeField;

  const pipeline = [
    { $match: match },
    {
      $facet: {
        items: [
          { $sort: { [sortBy]: sortDir, _id: sortDir } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              userId: 1,
              accountId: 1,
              ipAddress: 1,

              positionId: 1,
              ticket: 1,
              closeTicket: 1,
              symbol: 1,
              side: 1,
              orderType: 1,
              status: 1,

              volume: 1,
              contractSize: 1,
              leverage: 1,
              openPrice: 1,
              entryPrice: 1,
              closePrice: 1,

              stopLoss: 1,
              takeProfit: 1,

              marginUsed: 1,
              grossPnL: 1,
              commission: 1,
              spread: 1,
              swap: 1,
              realizedPnL: 1,

              openTime: 1,
              closeTime: 1,
              closeReason: 1,

              engineVersion: 1,

              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
      },
    },
    {
      $project: {
        items: 1,
        total: 1,
      },
    },
  ];

  const agg = await Trade.aggregate(pipeline).allowDiskUse(true);
  const row = agg?.[0] || { items: [], total: 0 };
  const totalRaw = Number(row.total);
  const total = Number.isFinite(totalRaw) ? totalRaw : 0;
  const items = await attachUserAccountLabels(
    Array.isArray(row.items) ? row.items : []
  );

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
};

export const adminListOpenTradesService = async (query = {}) => {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const skip = (page - 1) * limit;

  if (typeof query.status === "string" && query.status.trim()) {
    const status = query.status.trim().toUpperCase();
    if (status !== "OPEN") {
      throw new Error("Invalid status. Allowed: OPEN");
    }
  }

  const match = {
    status: "OPEN",
    isDeleted: { $ne: true },
  };

  if (query.userId !== undefined) {
    if (!mongoose.isValidObjectId(query.userId)) {
      throw new Error("Invalid userId");
    }
    match.userId = new mongoose.Types.ObjectId(query.userId);
  }

  if (query.accountId !== undefined) {
    if (!mongoose.isValidObjectId(query.accountId)) {
      throw new Error("Invalid accountId");
    }
    match.accountId = new mongoose.Types.ObjectId(query.accountId);
  }

  if (typeof query.positionId === "string" && query.positionId.trim()) {
    match.positionId = query.positionId.trim();
  }

  if (typeof query.symbol === "string" && query.symbol.trim()) {
    match.symbol = query.symbol.trim().toUpperCase();
  }

  if (typeof query.side === "string" && query.side.trim()) {
    const side = query.side.trim().toUpperCase();
    if (!TRADE_SIDES.has(side)) {
      throw new Error("Invalid side. Allowed: BUY, SELL");
    }
    match.side = side;
  }

  if (typeof query.orderType === "string" && query.orderType.trim()) {
    const orderType = query.orderType.trim().toUpperCase();
    if (!TRADE_ORDER_TYPES.has(orderType)) {
      throw new Error(
        "Invalid orderType. Allowed: MARKET, BUY_LIMIT, SELL_LIMIT, BUY_STOP, SELL_STOP",
      );
    }
    match.orderType = orderType;
  } else if (typeof query.orderKind === "string" && query.orderKind.trim()) {
    const orderKind = query.orderKind.trim().toUpperCase();
    const mappedTypes = TRADE_ORDER_KIND_TO_TYPES[orderKind];
    if (!mappedTypes) {
      throw new Error("Invalid orderKind. Allowed: MARKET, LIMIT, STOP");
    }
    match.orderType = { $in: mappedTypes };
  }

  if (query.brokerId) {
    await applyBrokerUserIdMatch(match, query.brokerId, "userId");
  }

  const timeFieldRaw =
    typeof query.timeField === "string" ? query.timeField.trim() : "";
  const timeField = ["openTime", "createdAt", "updatedAt"].includes(timeFieldRaw)
    ? timeFieldRaw
    : "openTime";

  const from = typeof query.from === "string" ? new Date(query.from) : null;
  const to = typeof query.to === "string" ? new Date(query.to) : null;
  const fromValid = from instanceof Date && !Number.isNaN(from.getTime());
  const toValid = to instanceof Date && !Number.isNaN(to.getTime());

  if (query.from && !fromValid) {
    throw new Error("Invalid from date");
  }
  if (query.to && !toValid) {
    throw new Error("Invalid to date");
  }

  if (fromValid || toValid) {
    match[timeField] = {};
    if (fromValid) match[timeField].$gte = from;
    if (toValid) match[timeField].$lte = to;
  }

  const sortDirRaw =
    typeof query.sortDir === "string" ? query.sortDir.trim().toLowerCase() : "";
  const sortDir = sortDirRaw === "asc" ? 1 : -1;
  const sortByRaw =
    typeof query.sortBy === "string" ? query.sortBy.trim() : "";
  const sortBy = ["openTime", "createdAt", "updatedAt"].includes(sortByRaw)
    ? sortByRaw
    : timeField;

  const pipeline = [
    { $match: match },
    {
      $facet: {
        items: [
          { $sort: { [sortBy]: sortDir, _id: sortDir } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              userId: 1,
              accountId: 1,
              ipAddress: 1,

              positionId: 1,
              ticket: 1,
              closeTicket: 1,
              symbol: 1,
              side: 1,
              orderType: 1,
              status: 1,

              volume: 1,
              contractSize: 1,
              leverage: 1,
              openPrice: 1,
              entryPrice: 1,
              closePrice: 1,

              stopLoss: 1,
              takeProfit: 1,

              marginUsed: 1,
              grossPnL: 1,
              commission: 1,
              spread: 1,
              swap: 1,
              realizedPnL: 1,

              openTime: 1,
              closeTime: 1,
              closeReason: 1,

              engineVersion: 1,

              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
      },
    },
    {
      $project: {
        items: 1,
        total: 1,
      },
    },
  ];

  const agg = await Trade.aggregate(pipeline).allowDiskUse(true);
  const row = agg?.[0] || { items: [], total: 0 };
  const totalRaw = Number(row.total);
  const total = Number.isFinite(totalRaw) ? totalRaw : 0;
  const items = await attachUserAccountLabels(
    Array.isArray(row.items) ? row.items : []
  );

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
};

export const adminListPendingOrdersOpenService = async (query = {}) => {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const skip = (page - 1) * limit;

  if (typeof query.status === "string" && query.status.trim()) {
    const status = query.status.trim().toUpperCase();
    if (status !== "PENDING") {
      throw new Error("Invalid status. Allowed: PENDING");
    }
  }

  const match = {
    status: "PENDING",
    isDeleted: { $ne: true },
  };

  if (query.userId !== undefined) {
    if (!mongoose.isValidObjectId(query.userId)) {
      throw new Error("Invalid userId");
    }
    match.userId = new mongoose.Types.ObjectId(query.userId);
  }

  if (query.accountId !== undefined) {
    if (!mongoose.isValidObjectId(query.accountId)) {
      throw new Error("Invalid accountId");
    }
    match.accountId = new mongoose.Types.ObjectId(query.accountId);
  }

  if (typeof query.orderId === "string" && query.orderId.trim()) {
    match.orderId = query.orderId.trim();
  }

  if (typeof query.symbol === "string" && query.symbol.trim()) {
    match.symbol = query.symbol.trim().toUpperCase();
  }

  if (typeof query.side === "string" && query.side.trim()) {
    const side = query.side.trim().toUpperCase();
    if (!TRADE_SIDES.has(side)) {
      throw new Error("Invalid side. Allowed: BUY, SELL");
    }
    match.side = side;
  }

  if (typeof query.orderType === "string" && query.orderType.trim()) {
    const orderType = query.orderType.trim().toUpperCase();
    if (!PENDING_ORDER_TYPES.has(orderType)) {
      throw new Error(
        "Invalid orderType. Allowed: BUY_LIMIT, SELL_LIMIT, BUY_STOP, SELL_STOP",
      );
    }
    match.orderType = orderType;
  } else if (typeof query.orderKind === "string" && query.orderKind.trim()) {
    const orderKind = query.orderKind.trim().toUpperCase();
    const mappedTypes = PENDING_ORDER_KIND_TO_TYPES[orderKind];
    if (!mappedTypes) {
      throw new Error("Invalid orderKind. Allowed: LIMIT, STOP");
    }
    match.orderType = { $in: mappedTypes };
  }

  if (query.brokerId) {
    await applyBrokerUserIdMatch(match, query.brokerId, "userId");
  }

  const timeFieldRaw =
    typeof query.timeField === "string" ? query.timeField.trim() : "";
  const timeField = ["createdAt", "updatedAt", "expireAt"].includes(timeFieldRaw)
    ? timeFieldRaw
    : "createdAt";

  const from = typeof query.from === "string" ? new Date(query.from) : null;
  const to = typeof query.to === "string" ? new Date(query.to) : null;
  const fromValid = from instanceof Date && !Number.isNaN(from.getTime());
  const toValid = to instanceof Date && !Number.isNaN(to.getTime());

  if (query.from && !fromValid) {
    throw new Error("Invalid from date");
  }
  if (query.to && !toValid) {
    throw new Error("Invalid to date");
  }

  if (fromValid || toValid) {
    match[timeField] = {};
    if (fromValid) match[timeField].$gte = from;
    if (toValid) match[timeField].$lte = to;
  }

  const sortDirRaw =
    typeof query.sortDir === "string" ? query.sortDir.trim().toLowerCase() : "";
  const sortDir = sortDirRaw === "asc" ? 1 : -1;
  const sortByRaw =
    typeof query.sortBy === "string" ? query.sortBy.trim() : "";
  const sortBy = ["createdAt", "updatedAt", "expireAt"].includes(sortByRaw)
    ? sortByRaw
    : timeField;

  const pipeline = [
    { $match: match },
    {
      $facet: {
        items: [
          { $sort: { [sortBy]: sortDir, _id: sortDir } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              userId: 1,
              accountId: 1,

              orderId: 1,
              ticket: 1,
              executedPositionId: 1,

              symbol: 1,
              side: 1,
              orderType: 1,

              price: 1,
              volume: 1,

              stopLoss: 1,
              takeProfit: 1,

              status: 1,
              executedAt: 1,
              cancelledAt: 1,
              expireAt: 1,
              failReason: 1,
              failedAt: 1,

              engineVersion: 1,

              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
      },
    },
    {
      $project: {
        items: 1,
        total: 1,
      },
    },
  ];

  const agg = await PendingOrder.aggregate(pipeline).allowDiskUse(true);
  const row = agg?.[0] || { items: [], total: 0 };
  const totalRaw = Number(row.total);
  const total = Number.isFinite(totalRaw) ? totalRaw : 0;
  const items = await attachUserAccountLabels(
    Array.isArray(row.items) ? row.items : []
  );

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
};

export const adminListPendingOrdersHistoryService = async (query = {}) => {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const skip = (page - 1) * limit;

  const match = {};

  const statusRaw =
    typeof query.status === "string" ? query.status.trim().toUpperCase() : "";
  if (statusRaw) {
    if (statusRaw === "ALL") {
      match.status = { $in: PENDING_ORDER_HISTORY_STATUSES };
    } else if (statusRaw === "REJECTED") {
      match.status = { $in: PENDING_ORDER_REJECTED_STATUSES };
    } else if (PENDING_ORDER_HISTORY_STATUSES.includes(statusRaw)) {
      match.status = statusRaw;
    } else if (statusRaw === "PENDING") {
      throw new Error("PENDING is not allowed in this endpoint");
    } else {
      throw new Error(
        "Invalid status. Allowed: EXECUTED, CANCELLED, EXPIRED, FAILED, REJECTED, ALL",
      );
    }
  } else {
    match.status = { $in: PENDING_ORDER_HISTORY_STATUSES };
  }

  if (query.userId !== undefined) {
    if (!mongoose.isValidObjectId(query.userId)) {
      throw new Error("Invalid userId");
    }
    match.userId = new mongoose.Types.ObjectId(query.userId);
  }

  if (query.accountId !== undefined) {
    if (!mongoose.isValidObjectId(query.accountId)) {
      throw new Error("Invalid accountId");
    }
    match.accountId = new mongoose.Types.ObjectId(query.accountId);
  }

  if (typeof query.orderId === "string" && query.orderId.trim()) {
    match.orderId = query.orderId.trim();
  }

  if (
    typeof query.executedPositionId === "string" &&
    query.executedPositionId.trim()
  ) {
    match.executedPositionId = query.executedPositionId.trim();
  }

  if (typeof query.symbol === "string" && query.symbol.trim()) {
    match.symbol = query.symbol.trim().toUpperCase();
  }

  if (typeof query.side === "string" && query.side.trim()) {
    const side = query.side.trim().toUpperCase();
    if (!TRADE_SIDES.has(side)) {
      throw new Error("Invalid side. Allowed: BUY, SELL");
    }
    match.side = side;
  }

  if (typeof query.orderType === "string" && query.orderType.trim()) {
    const orderType = query.orderType.trim().toUpperCase();
    if (!PENDING_ORDER_TYPES.has(orderType)) {
      throw new Error(
        "Invalid orderType. Allowed: BUY_LIMIT, SELL_LIMIT, BUY_STOP, SELL_STOP",
      );
    }
    match.orderType = orderType;
  } else if (typeof query.orderKind === "string" && query.orderKind.trim()) {
    const orderKind = query.orderKind.trim().toUpperCase();
    const mappedTypes = PENDING_ORDER_KIND_TO_TYPES[orderKind];
    if (!mappedTypes) {
      throw new Error("Invalid orderKind. Allowed: LIMIT, STOP");
    }
    match.orderType = { $in: mappedTypes };
  }

  if (query.brokerId) {
    await applyBrokerUserIdMatch(match, query.brokerId, "userId");
  }

  const timeFieldRaw =
    typeof query.timeField === "string" ? query.timeField.trim() : "";
  const timeField = [
    "createdAt",
    "updatedAt",
    "executedAt",
    "cancelledAt",
    "expireAt",
    "failedAt",
  ].includes(timeFieldRaw)
    ? timeFieldRaw
    : "createdAt";

  const from = typeof query.from === "string" ? new Date(query.from) : null;
  const to = typeof query.to === "string" ? new Date(query.to) : null;
  const fromValid = from instanceof Date && !Number.isNaN(from.getTime());
  const toValid = to instanceof Date && !Number.isNaN(to.getTime());

  if (query.from && !fromValid) {
    throw new Error("Invalid from date");
  }
  if (query.to && !toValid) {
    throw new Error("Invalid to date");
  }

  if (fromValid || toValid) {
    match[timeField] = {};
    if (fromValid) match[timeField].$gte = from;
    if (toValid) match[timeField].$lte = to;
  }

  const sortDirRaw =
    typeof query.sortDir === "string" ? query.sortDir.trim().toLowerCase() : "";
  const sortDir = sortDirRaw === "asc" ? 1 : -1;
  const sortByRaw =
    typeof query.sortBy === "string" ? query.sortBy.trim() : "";
  const sortBy = [
    "createdAt",
    "updatedAt",
    "executedAt",
    "cancelledAt",
    "expireAt",
    "failedAt",
  ].includes(sortByRaw)
    ? sortByRaw
    : timeField;

  const pipeline = [
    { $match: match },
    {
      $facet: {
        items: [
          { $sort: { [sortBy]: sortDir, _id: sortDir } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              userId: 1,
              accountId: 1,

              orderId: 1,
              ticket: 1,
              executedPositionId: 1,

              symbol: 1,
              side: 1,
              orderType: 1,

              price: 1,
              volume: 1,

              stopLoss: 1,
              takeProfit: 1,

              status: 1,
              executedAt: 1,
              cancelledAt: 1,
              expireAt: 1,
              failReason: 1,
              failedAt: 1,

              engineVersion: 1,

              createdAt: 1,
              updatedAt: 1,
            },
          },
        ],
        meta: [{ $count: "total" }],
      },
    },
    {
      $addFields: {
        total: { $ifNull: [{ $arrayElemAt: ["$meta.total", 0] }, 0] },
      },
    },
    {
      $project: {
        items: 1,
        total: 1,
      },
    },
  ];

  const agg = await PendingOrder.aggregate(pipeline).allowDiskUse(true);
  const row = agg?.[0] || { items: [], total: 0 };
  const totalRaw = Number(row.total);
  const total = Number.isFinite(totalRaw) ? totalRaw : 0;
  const items = await attachUserAccountLabels(
    Array.isArray(row.items) ? row.items : []
  );

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
};

export const adminListBrokerageService = async (query = {}) => {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 10;
  const skip = (page - 1) * limit;

  const filter = {};

  if (query.userId && mongoose.isValidObjectId(query.userId)) {
    filter.user_id = new mongoose.Types.ObjectId(query.userId);
  }

  if (query.accountId && mongoose.isValidObjectId(query.accountId)) {
    filter.account_id = new mongoose.Types.ObjectId(query.accountId);
  }

  if (query.tradeId && mongoose.isValidObjectId(query.tradeId)) {
    filter.trade_id = new mongoose.Types.ObjectId(query.tradeId);
  }

  if (query.symbol) {
    filter.symbol = String(query.symbol).trim().toUpperCase();
  }

  if (query.brokerId) {
    await applyBrokerUserIdMatch(filter, query.brokerId, "user_id");
  }

  const from = typeof query.from === "string" ? new Date(query.from) : null;
  const to = typeof query.to === "string" ? new Date(query.to) : null;
  const fromValid = from instanceof Date && !Number.isNaN(from.getTime());
  const toValid = to instanceof Date && !Number.isNaN(to.getTime());

  if (fromValid || toValid) {
    filter.createdAt = {};
    if (fromValid) filter.createdAt.$gte = from;
    if (toValid) filter.createdAt.$lte = to;
  }

  const [rawItems, total] = await Promise.all([
    Brokerage.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Brokerage.countDocuments(filter),
  ]);

  const items = await attachUserAccountLabels(rawItems, {
    userKey: "user_id",
    accountKey: "account_id",
  });

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};
