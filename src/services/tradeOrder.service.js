import mongoose from "mongoose";
import Trade from "../models/Trade.model.js";
import Transaction from "../models/Transaction.model.js";
import Account from "../models/Account.model.js";

const DATE_FILTERS = new Set([
  "today",
  "lastweek",
  "lastweak",
  "last3months",
  "last_3_months",
  "last3month",
  "custom",
]);

function normalizeSymbolFilter(symbol, symbols) {
  const rawSymbols =
    symbols !== undefined && symbols !== null && symbols !== ""
      ? symbols
      : symbol;

  if (!rawSymbols) {
    return [];
  }

  const values = Array.isArray(rawSymbols)
    ? rawSymbols
    : String(rawSymbols).split(",");

  const normalized = values
    .map((item) => String(item).trim().toUpperCase())
    .filter(Boolean);

  return [...new Set(normalized)];
}

function parseDate(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return date;
}

function buildOpenTimeFilter({
  filter,
  from,
  to,
  startDate,
  endDate,
}) {
  const selectedFilter = filter ? String(filter).toLowerCase() : null;
  const now = new Date();
  const range = {};

  const customFrom = from || startDate;
  const customTo = to || endDate;

  if (selectedFilter && !DATE_FILTERS.has(selectedFilter)) {
    throw new Error(
      "Invalid filter. Use: today, lastweek, last3months, custom"
    );
  }

  if (selectedFilter === "today") {
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    range.$gte = dayStart;
    range.$lte = now;
    return range;
  }

  if (selectedFilter === "lastweek" || selectedFilter === "lastweak") {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);
    range.$gte = weekStart;
    range.$lte = now;
    return range;
  }

  if (
    selectedFilter === "last3months" ||
    selectedFilter === "last_3_months" ||
    selectedFilter === "last3month"
  ) {
    const monthsStart = new Date(now);
    monthsStart.setMonth(monthsStart.getMonth() - 3);
    monthsStart.setHours(0, 0, 0, 0);
    range.$gte = monthsStart;
    range.$lte = now;
    return range;
  }

  if (selectedFilter === "custom") {
    if (!customFrom || !customTo) {
      throw new Error("For custom filter, from/startDate and to/endDate are required");
    }

    const start = parseDate(customFrom, "from/startDate");
    const end = parseDate(customTo, "to/endDate");
    if (start > end) {
      throw new Error("from/startDate must be less than or equal to to/endDate");
    }

    range.$gte = start;
    range.$lte = end;
    return range;
  }

  if (customFrom || customTo) {
    if (customFrom) range.$gte = parseDate(customFrom, "from/startDate");
    if (customTo) range.$lte = parseDate(customTo, "to/endDate");
    if (range.$gte && range.$lte && range.$gte > range.$lte) {
      throw new Error("from/startDate must be less than or equal to to/endDate");
    }
    return range;
  }

  return null;
}

export async function getOrdersService({
  accountId,
  page = 1,
  limit = 20,
  symbol,
  symbols,
  filter,
  from,
  to,
  startDate,
  endDate,
}) {
  /* =========================
     SAFE ObjectId CAST
  ========================== */
  const accountObjectId = new mongoose.Types.ObjectId(accountId);

  /* =========================
     BASE FILTER
  ========================== */
  const match = {
    accountId: accountObjectId,
    status: { $in: ["CLOSED", "CANCELLED"] },
  };

  const symbolFilter = normalizeSymbolFilter(symbol, symbols);
  if (symbolFilter.length === 1) {
    match.symbol = symbolFilter[0];
  } else if (symbolFilter.length > 1) {
    match.symbol = { $in: symbolFilter };
  }

  const openTimeFilter = buildOpenTimeFilter({
    filter,
    from,
    to,
    startDate,
    endDate,
  });
  if (openTimeFilter) {
    match.openTime = openTimeFilter;
  }

  /* =========================
     SUMMARY
  ========================== */
  const summaryPipeline = [
    { $match: match },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalFilled: {
          $sum: { $cond: [{ $eq: ["$status", "CLOSED"] }, 1, 0] },
        },
        totalCancelled: {
          $sum: { $cond: [{ $eq: ["$status", "CANCELLED"] }, 1, 0] },
        },
      },
    },
  ];

  /* =========================
     ORDERS LIST
  ========================== */
  const ordersQuery = Trade.find(match)
    .sort({ openTime: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select({
      positionId: 1,
      symbol: 1,
      side: 1,
      orderType: 1,
      volume: 1,
      status: 1,
      stopLoss: 1,
      takeProfit: 1,
      openTime: 1,
      closeTime: 1,
    })
    .lean();

  const countQuery = Trade.countDocuments(match);

  const [summaryAgg, orders, totalRecords] = await Promise.all([
    Trade.aggregate(summaryPipeline),
    ordersQuery,
    countQuery,
  ]);

  const summary = summaryAgg[0] || {
    totalOrders: 0,
    totalFilled: 0,
    totalCancelled: 0,
  };

  return {
    summary: {
      totalOrders: summary.totalOrders,
      totalFilled: summary.totalFilled,
      totalCancelled: summary.totalCancelled,
      totalRejected: 0,
    },
    orders: orders.map((o) => ({
      orderId: o.positionId,
      symbol: o.symbol,
      side: o.side,
      orderType: o.orderType,
      qty: o.volume,
      status: o.status,
      stopLoss: o.stopLoss,
      takeProfit: o.takeProfit,
      openTime: o.openTime,
      closeTime: o.closeTime,
    })),
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages:
        totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit),
    },
  };
}

export async function getDealsService({
  accountId,
  page = 1,
  limit = 20,
  symbol,
  symbols,
  filter,
  from,
  to,
  startDate,
  endDate,
}) {
  const accountObjectId = new mongoose.Types.ObjectId(accountId);

  /* =========================
     BASE MATCH (ALL TRADES)
  ========================== */
  const match = {
    accountId: accountObjectId,
  };

  const symbolFilter = normalizeSymbolFilter(symbol, symbols);
  if (symbolFilter.length === 1) {
    match.symbol = symbolFilter[0];
  } else if (symbolFilter.length > 1) {
    match.symbol = { $in: symbolFilter };
  }

  const openTimeFilter = buildOpenTimeFilter({
    filter,
    from,
    to,
    startDate,
    endDate,
  });
  if (openTimeFilter) {
    match.openTime = openTimeFilter;
  }

  /* =========================
     FETCH TRADES
  ========================== */
  const trades = await Trade.find(match).sort({ openTime: -1 }).lean();

  // MT5 shows successful balance operations in the Deals history alongside
  // executions. A symbol-filtered view remains trade-only because balance
  // operations do not belong to an instrument.
  const balanceTransactionMatch = {
    account: accountObjectId,
    status: "SUCCESS",
    type: { $in: ["DEPOSIT", "WITHDRAWAL"] },
  };
  if (openTimeFilter) {
    balanceTransactionMatch.createdAt = openTimeFilter;
  }
  const balanceTransactions =
    symbolFilter.length === 0
      ? await Transaction.find(balanceTransactionMatch)
          .sort({ createdAt: -1 })
          .lean()
      : [];

  /* =========================
     BUILD MT5 DEALS (IN + OUT)
  ========================== */
  const deals = [];
  let totalTradingProfit = 0;
  let totalSwapAmount = 0;

  for (const t of trades) {
    // ---------- IN DEAL ----------
    deals.push({
      time: t.openTime,
      deal: `${t.positionId}-IN`,
      order: t.positionId,
      tradeId: t.positionId,
      symbol: t.symbol,
      type: t.side === "BUY" ? "BUY_IN" : "SELL_IN",
      direction: "in",
      volume: t.volume,
      price: t.openPrice,
      date: t.openTime,
      swap: 0,
      commission: t.commission || 0,
      fee: 0,
      pnl: 0,
      profit: 0,
      balance: null,
      comment: "",
    });

    // ---------- OUT DEAL ----------
    if (t.status === "CLOSED" && t.closeTime) {
      const closeProfit = Number(t.realizedPnL) || 0;
      totalTradingProfit += closeProfit;
      totalSwapAmount += Number(t.swap) || 0;

      deals.push({
        time: t.closeTime,
        deal: `${t.positionId}-OUT`,
        order: t.positionId,
        tradeId: t.positionId,
        symbol: t.symbol,
        type: t.side === "BUY" ? "SELL_OUT" : "BUY_OUT",
        direction: "out",
        volume: t.volume,
        price: t.closePrice,
        date: t.closeTime,
        swap: t.swap || 0,
        commission: t.commission || 0,
        fee: 0,
        pnl: closeProfit,
        profit: closeProfit,
        balance: null,
        comment: "",
      });
    }
  }

  for (const transaction of balanceTransactions) {
    const isWithdrawal = transaction.type === "WITHDRAWAL";
    const signedAmount = isWithdrawal
      ? -Number(transaction.amount || 0)
      : Number(transaction.amount || 0);

    deals.push({
      time: transaction.createdAt,
      date: transaction.createdAt,
      deal: String(transaction._id),
      order: null,
      tradeId: String(transaction._id),
      symbol: "",
      type: "BALANCE",
      transactionType: transaction.type,
      direction: "balance",
      volume: 0,
      price: 0,
      swap: 0,
      commission: 0,
      fee: 0,
      pnl: signedAmount,
      profit: signedAmount,
      balance: Number(transaction.balanceAfter),
      comment:
        transaction.remark === "Admin deposit"
          ? "Transfer from 7141159766"
          : transaction.remark ||
            (isWithdrawal ? "Withdrawal" : "Deposit"),
    });
  }

  /* =========================
     SORT DEALS BY TIME (DESC)
  ========================== */
  deals.sort((a, b) => new Date(b.date) - new Date(a.date));

  /* =========================
     PAGINATION
  ========================== */
  const totalRecords = deals.length;
  const start = (page - 1) * limit;
  const paginatedDeals = deals.slice(start, start + limit);

  return {
    summary: {
      totalTradingProfit: Number(totalTradingProfit.toFixed(2)),
      totalSwap: Number(totalSwapAmount.toFixed(2)),
    },
    deals: paginatedDeals,
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages:
        totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit),
    },
  };
}

export async function getTradeSummaryService({ accountId, from, to }) {
  const accountObjectId = new mongoose.Types.ObjectId(accountId);

  /* =========================
     DATE FILTER
  ========================== */
  const dateFilter = {};
  if (from) dateFilter.$gte = new Date(from);
  if (to) dateFilter.$lte = new Date(to);

  const baseMatch = {
    account: accountObjectId,
    status: "SUCCESS",
    ...(from || to ? { createdAt: dateFilter } : {}),
  };

  /* =========================
     TRANSACTION AGGREGATION
  ========================== */
  const summaryPipeline = [
    { $match: baseMatch },
    {
      $group: {
        _id: null,

        /* -------- DEPOSIT -------- */
        totalDeposit: {
          $sum: {
            $cond: [
              {
                $in: [
                  "$type",
                  ["DEPOSIT", "INTERNAL_TRANSFER_IN"],
                ],
              },
              "$amount",
              0,
            ],
          },
        },

        /* -------- WITHDRAW -------- */
        totalWithdraw: {
          $sum: {
            $cond: [
              {
                $in: [
                  "$type",
                  ["WITHDRAWAL", "INTERNAL_TRANSFER_OUT"],
                ],
              },
              "$amount",
              0,
            ],
          },
        },

        /* -------- NET TRADING PNL -------- */
        totalPnL: {
          $sum: {
            $cond: [
              { $eq: ["$type", "TRADE_PROFIT"] },
              "$amount",
              {
                $cond: [
                  { $eq: ["$type", "TRADE_LOSS"] },
                  { $multiply: ["$amount", -1] },
                  0,
                ],
              },
            ],
          },
        },

        /* -------- COMMISSION -------- */
        totalCommission: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$referenceType", "ORDER"] },
                  { $regexMatch: { input: "$remark", regex: /commission/i } },
                ],
              },
              "$amount",
              0,
            ],
          },
        },

        /* -------- SWAP -------- */
        totalSwap: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$referenceType", "ORDER"] },
                  { $regexMatch: { input: "$remark", regex: /swap/i } },
                ],
              },
              "$amount",
              0,
            ],
          },
        },
      },
    },
  ];

  const [aggResult, account] = await Promise.all([
    Transaction.aggregate(summaryPipeline),
    Account.findById(accountObjectId)
      .select({ balance: 1 })
      .lean(),
  ]);

  const totals = aggResult[0] || {
    totalDeposit: 0,
    totalWithdraw: 0,
    totalPnL: 0,
    totalCommission: 0,
    totalSwap: 0,
  };

  return {
    totalDeposit: Number(totals.totalDeposit.toFixed(2)),
    totalWithdraw: Number(totals.totalWithdraw.toFixed(2)),
    totalPnL: Number(totals.totalPnL.toFixed(2)),
    totalCommission: Number(totals.totalCommission.toFixed(2)),
    totalSwap: Number(totals.totalSwap.toFixed(2)),
    balance: account ? Number(account.balance.toFixed(2)) : 0,
  };
}
export async function getPositionsService({
  accountId,
  page,
  limit,
  symbol,
  symbols,
  filter,
  from,
  to,
  startDate,
  endDate,
  status,
}) {
  const accountObjectId = new mongoose.Types.ObjectId(accountId);

  /* =========================
     BASE FILTER
  ========================== */
  const match = {
    accountId: accountObjectId,
  };

  const symbolFilter = normalizeSymbolFilter(symbol, symbols);
  if (symbolFilter.length === 1) {
    match.symbol = symbolFilter[0];
  } else if (symbolFilter.length > 1) {
    match.symbol = { $in: symbolFilter };
  }

  if (status && ["OPEN", "CLOSED"].includes(status)) {
    match.status = status;
  }

  const openTimeFilter = buildOpenTimeFilter({
    filter,
    from,
    to,
    startDate,
    endDate,
  });
  if (openTimeFilter) {
    match.openTime = openTimeFilter;
  }

  /* =========================
     QUERY
  ========================== */
  const positionsQuery = Trade.find(match)
    .sort({ openTime: -1 })
    .select({
      positionId: 1,
      symbol: 1,
      side: 1,
      volume: 1,
      openPrice: 1,
      closePrice: 1,
      contractSize: 1,
      realizedPnL: 1,
      openTime: 1,
      closeTime: 1,
      stopLoss: 1,
      takeProfit: 1,
      swap: 1,
      commission: 1,
      status: 1,
    })
    .lean();

  const balanceTransactionMatch = {
    account: accountObjectId,
    status: "SUCCESS",
    type: { $in: ["DEPOSIT", "WITHDRAWAL"] },
  };
  if (openTimeFilter) {
    balanceTransactionMatch.createdAt = openTimeFilter;
  }

  const balanceTransactionsQuery =
    symbolFilter.length === 0 && !status
      ? Transaction.find(balanceTransactionMatch)
          .sort({ createdAt: -1 })
          .lean()
      : Promise.resolve([]);

  const [positions, balanceTransactions] = await Promise.all([
    positionsQuery,
    balanceTransactionsQuery,
  ]);

  /* =========================
     FORMAT RESPONSE (WITH P/L)
  ========================== */
  const formatted = positions.map((p) => {
    let profitLoss = 0;

    // ✅ Only calculate for CLOSED trades
    if (p.status === "CLOSED" && p.closePrice) {
      if (Number.isFinite(Number(p.realizedPnL))) {
        profitLoss = Number(p.realizedPnL);
      } else {
        const contractSize = Number(p.contractSize) || 1;
        if (p.side === "BUY") {
          profitLoss = (p.closePrice - p.openPrice) * p.volume * contractSize;
        }

        if (p.side === "SELL") {
          profitLoss = (p.openPrice - p.closePrice) * p.volume * contractSize;
        }
      }
    }

    // Deduct commission & swap
    profitLoss =
      profitLoss - (p.commission || 0) - (p.swap || 0);

    return {
      orderId: p.positionId,
      symbol: p.symbol,
      qty: p.volume,
      side: p.side,

      openPrice: p.openPrice,
      closePrice: p.closePrice,

      openTime: p.openTime,
      closeTime: p.closeTime,

      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,

      swap: p.swap || 0,
      commission: p.commission || 0,

      profitLoss: Number(profitLoss.toFixed(2)), // ✅ ADD

      status: p.status,
    };
  });

  for (const transaction of balanceTransactions) {
    const isWithdrawal = transaction.type === "WITHDRAWAL";
    const signedAmount = isWithdrawal
      ? -Number(transaction.amount || 0)
      : Number(transaction.amount || 0);

    formatted.push({
      orderId: String(transaction._id),
      type: "BALANCE",
      transactionType: transaction.type,
      isBalanceEntry: true,
      symbol: "",
      qty: 0,
      side: "BALANCE",
      openPrice: null,
      closePrice: null,
      openTime: transaction.createdAt,
      closeTime: transaction.createdAt,
      stopLoss: null,
      takeProfit: null,
      swap: 0,
      commission: 0,
      profitLoss: signedAmount,
      balance: Number(transaction.balanceAfter),
      comment:
        transaction.remark === "Admin deposit"
          ? "Transfer from 7141159766"
          : transaction.remark ||
            (isWithdrawal ? "Withdrawal" : "Deposit"),
      status: "SUCCESS",
    });
  }

  formatted.sort(
    (a, b) => new Date(b.openTime).getTime() - new Date(a.openTime).getTime(),
  );

  const totalRecords = formatted.length;
  const start = (page - 1) * limit;
  const paginatedPositions = formatted.slice(start, start + limit);

  return {
    positions: paginatedPositions,
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages:
        totalRecords === 0
          ? 0
          : Math.ceil(totalRecords / limit),
    },
  };
}

/* =========================
   GET FULL ACCOUNT DETAILS
========================= */
export async function getSingleAccountService(accountId) {
  const accountObjectId = new mongoose.Types.ObjectId(accountId);

  /* =========================
     FETCH ACCOUNT
  ========================== */
  const account = await Account.findById(accountObjectId)
    .select({
      user_id: 1,

      account_number: 1,
      account_type: 1,

      plan_name: 1,
      leverage: 1,
      spread_type: 1,
      spread_pips: 1,
      commission_per_lot: 1,
      swap_enabled: 1,

      balance: 1,
      hold_balance: 1,
      equity: 1,
      bonus_balance: 1,
      bonus_granted: 1,
      bonus_percent_override: 1,
      currency: 1,

      first_deposit: 1,
      status: 1,

      createdAt: 1,
      updatedAt: 1,
    })
    .lean();

  if (!account) {
    throw new Error("Account not found");
  }

  /* =========================
     FORMAT RESPONSE
  ========================== */
  return {
    accountId: account._id,
    userId: account.user_id,

    accountNumber: account.account_number,
    accountType: account.account_type,

    planName: account.plan_name,
    leverage: account.leverage,

    spreadType: account.spread_type,
    spreadPips: account.spread_pips,

    commissionPerLot: Number(account.commission_per_lot.toFixed(2)),
    swapEnabled: account.swap_enabled,

    balance: Number(account.balance.toFixed(2)),
    holdBalance: Number(account.hold_balance.toFixed(2)),
    equity: Number(account.equity.toFixed(2)),
    bonusBalance: Number((account.bonus_balance || 0).toFixed(2)),
    bonusGranted: Number((account.bonus_granted || 0).toFixed(2)),
    bonusPercentOverride:
      typeof account.bonus_percent_override === "number"
        ? account.bonus_percent_override
        : null,

    currency: account.currency,

    firstDeposit: account.first_deposit,
    status: account.status,

    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}
