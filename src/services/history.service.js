import mongoose from "mongoose";
import Trade from "../models/Trade.model.js";
import PendingOrder from "../models/PendingOrder.model.js";
import Transaction from "../models/Transaction.model.js";
import {
  buildOpenTimeFilter,
  normalizeSymbolFilter,
} from "./tradeOrder.service.js";

/* =========================
   HELPERS
========================== */

function inRange(date, range) {
  if (!range) return true;
  if (!date) return false;
  const t = new Date(date).getTime();
  if (range.$gte && t < new Date(range.$gte).getTime()) return false;
  if (range.$lte && t > new Date(range.$lte).getTime()) return false;
  return true;
}

function symbolMatch(symbolFilter) {
  if (symbolFilter.length === 1) return symbolFilter[0];
  if (symbolFilter.length > 1) return { $in: symbolFilter };
  return undefined;
}

/** MT5 deal comment: TP/SL/stop-out se band hua to "[tp 1.12228]" jaisa. */
function closeComment(t) {
  switch (t.closeReason) {
    case "TAKE_PROFIT":
      return t.takeProfit != null ? `[tp ${t.takeProfit}]` : "[tp]";
    case "STOP_LOSS":
      return t.stopLoss != null ? `[sl ${t.stopLoss}]` : "[sl]";
    case "STOP_OUT":
      return "[stop out]";
    default:
      return "";
  }
}

function paginate(list, page, limit) {
  const totalRecords = list.length;
  const start = (page - 1) * limit;
  return {
    items: list.slice(start, start + limit),
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages: totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit),
    },
  };
}

async function loadTrades({ accountObjectId, symbolFilter, range }) {
  const match = { accountId: accountObjectId };
  const sym = symbolMatch(symbolFilter);
  if (sym) match.symbol = sym;
  if (range) match.$or = [{ openTime: range }, { closeTime: range }];
  return Trade.find(match).lean();
}

async function loadBalanceOps({ accountObjectId, symbolFilter, range }) {
  // Balance operations kisi symbol ki nahi hoti.
  if (symbolFilter.length > 0) return [];
  const match = {
    account: accountObjectId,
    status: "SUCCESS",
    type: { $in: ["DEPOSIT", "WITHDRAWAL"] },
  };
  if (range) match.createdAt = range;
  return Transaction.find(match).sort({ createdAt: -1 }).lean();
}

function balanceComment(transaction) {
  const isWithdrawal = transaction.type === "WITHDRAWAL";
  if (transaction.remark === "Admin deposit") return "Transfer from 7141159766";
  return transaction.remark || (isWithdrawal ? "Withdrawal" : "Deposit");
}

/* =========================
   ORDERS (MT5 History > Orders)
   - market open order (trade ke open pe)
   - close order (trade ke close pe, ulta side)
   - pending orders: executed / cancelled / expired
========================== */

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
  const accountObjectId = new mongoose.Types.ObjectId(accountId);
  const symbolFilter = normalizeSymbolFilter(symbol, symbols);
  const range = buildOpenTimeFilter({ filter, from, to, startDate, endDate });

  const pendMatch = {
    accountId: accountObjectId,
    status: { $in: ["EXECUTED", "CANCELLED", "EXPIRED", "FAILED"] },
  };
  const sym = symbolMatch(symbolFilter);
  if (sym) pendMatch.symbol = sym;

  const [trades, pendings] = await Promise.all([
    loadTrades({ accountObjectId, symbolFilter, range }),
    PendingOrder.find(pendMatch).lean(),
  ]);

  const orders = [];
  const pendingTickets = new Set();

  for (const p of pendings) {
    if (p.ticket != null) pendingTickets.add(p.ticket);
    const doneTime =
      p.executedAt || p.cancelledAt || p.failedAt || p.updatedAt || p.createdAt;
    if (!inRange(doneTime, range)) continue;
    const status =
      p.status === "EXECUTED"
        ? "FILLED"
        : p.status === "EXPIRED"
          ? "EXPIRED"
          : p.status === "FAILED"
            ? "REJECTED"
            : "CANCELED";
    orders.push({
      orderId: p.ticket != null ? String(p.ticket) : null,
      ticket: p.ticket != null ? String(p.ticket) : null,
      symbol: p.symbol,
      side: p.side,
      orderType: p.orderType,
      qty: p.volume,
      filledQty: p.status === "EXECUTED" ? p.volume : 0,
      price: p.price,
      atMarket: false,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      status,
      openTime: p.createdAt,
      time: doneTime,
      comment: "",
    });
  }

  for (const t of trades) {
    // Executed pending ka open order upar pending record se aa chuka.
    if (!pendingTickets.has(t.ticket) && inRange(t.openTime, range)) {
      orders.push({
        orderId: t.ticket != null ? String(t.ticket) : null,
        ticket: t.ticket != null ? String(t.ticket) : null,
        positionId: t.positionId != null ? String(t.positionId) : String(t.ticket),
        symbol: t.symbol,
        side: t.side,
        orderType: "MARKET",
        qty: t.volume,
        filledQty: t.volume,
        price: t.openPrice,
        atMarket: true,
        stopLoss: t.stopLoss,
        takeProfit: t.takeProfit,
        status: "FILLED",
        openTime: t.openTime,
        time: t.openTime,
        comment: "",
      });
    }
    if (t.status === "CLOSED" && t.closeTime && inRange(t.closeTime, range)) {
      const closeTicket = t.closeTicket ?? t.ticket;
      orders.push({
        orderId: closeTicket != null ? String(closeTicket) : null,
        ticket: closeTicket != null ? String(closeTicket) : null,
        positionId: t.positionId != null ? String(t.positionId) : String(t.ticket),
        symbol: t.symbol,
        side: t.side === "BUY" ? "SELL" : "BUY",
        orderType: "MARKET",
        qty: t.volume,
        filledQty: t.volume,
        price: t.closePrice,
        atMarket: true,
        stopLoss: null,
        takeProfit: null,
        status: "FILLED",
        openTime: t.closeTime,
        time: t.closeTime,
        comment: closeComment(t),
      });
    }
  }

  orders.sort((a, b) => new Date(b.time) - new Date(a.time));

  const totalFilled = orders.filter((o) => o.status === "FILLED").length;
  const totalCancelled = orders.filter(
    (o) => o.status === "CANCELED" || o.status === "EXPIRED",
  ).length;
  const totalRejected = orders.filter((o) => o.status === "REJECTED").length;
  const { items, pagination } = paginate(orders, page, limit);

  return {
    summary: {
      totalOrders: orders.length,
      totalFilled,
      totalCancelled,
      totalRejected,
    },
    orders: items,
    pagination,
  };
}

/* =========================
   DEALS (MT5 History > Deals)
   in deal: trade open, out deal: trade close, + balance operations
========================== */

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
  const symbolFilter = normalizeSymbolFilter(symbol, symbols);
  const range = buildOpenTimeFilter({ filter, from, to, startDate, endDate });

  const [trades, balanceOps] = await Promise.all([
    loadTrades({ accountObjectId, symbolFilter, range }),
    loadBalanceOps({ accountObjectId, symbolFilter, range }),
  ]);

  const deals = [];
  let totalTradingProfit = 0;
  let totalSwap = 0;
  let totalCommission = 0;
  let totalDeposit = 0;
  let totalWithdrawal = 0;

  for (const t of trades) {
    if (inRange(t.openTime, range)) {
      const commission = Number(t.commission) || 0;
      totalCommission += commission;
      const openDeal = t.openDealTicket ?? t.ticket;
      deals.push({
        time: t.openTime,
        date: t.openTime,
        deal: openDeal != null ? String(openDeal) : null,
        order: t.ticket != null ? String(t.ticket) : null,
        positionId: t.positionId != null ? String(t.positionId) : String(t.ticket),
        tradeId: t.ticket != null ? String(t.ticket) : null,
        symbol: t.symbol,
        type: t.side === "BUY" ? "BUY_IN" : "SELL_IN",
        direction: "in",
        volume: t.volume,
        price: t.openPrice,
        swap: 0,
        commission,
        fee: 0,
        pnl: 0,
        profit: 0,
        balance: null,
        comment: "",
      });
    }

    if (t.status === "CLOSED" && t.closeTime && inRange(t.closeTime, range)) {
      const profit = Number(t.realizedPnL) || 0;
      const swap = Number(t.swap) || 0;
      totalTradingProfit += profit;
      totalSwap += swap;
      const closeDeal = t.closeDealTicket ?? t.closeTicket ?? t.ticket;
      const closeOrder = t.closeTicket ?? t.ticket;
      deals.push({
        time: t.closeTime,
        date: t.closeTime,
        deal: closeDeal != null ? String(closeDeal) : null,
        order: closeOrder != null ? String(closeOrder) : null,
        positionId: t.positionId != null ? String(t.positionId) : String(t.ticket),
        tradeId: t.ticket != null ? String(t.ticket) : null,
        symbol: t.symbol,
        type: t.side === "BUY" ? "SELL_OUT" : "BUY_OUT",
        direction: "out",
        volume: t.volume,
        price: t.closePrice,
        swap,
        commission: 0,
        fee: 0,
        pnl: profit,
        profit,
        balance: null,
        closeReason: t.closeReason === "MANUAL" ? "MANUAL_CLOSE" : t.closeReason,
        comment: closeComment(t),
      });
    }
  }

  for (const transaction of balanceOps) {
    const isWithdrawal = transaction.type === "WITHDRAWAL";
    const amount = Number(transaction.amount || 0);
    if (isWithdrawal) totalWithdrawal += amount;
    else totalDeposit += amount;
    const signed = isWithdrawal ? -amount : amount;
    deals.push({
      time: transaction.createdAt,
      date: transaction.createdAt,
      deal: null,
      order: null,
      tradeId: null,
      symbol: "",
      type: "BALANCE",
      transactionType: transaction.type,
      direction: "balance",
      volume: 0,
      price: 0,
      swap: 0,
      commission: 0,
      fee: 0,
      pnl: signed,
      profit: signed,
      balance: Number(transaction.balanceAfter),
      comment: balanceComment(transaction),
    });
  }

  deals.sort((a, b) => new Date(b.date) - new Date(a.date));
  const { items, pagination } = paginate(deals, page, limit);

  return {
    summary: {
      totalTradingProfit: Number(totalTradingProfit.toFixed(2)),
      totalSwap: Number(totalSwap.toFixed(2)),
      totalCommission: Number(totalCommission.toFixed(2)),
      totalDeposit: Number(totalDeposit.toFixed(2)),
      totalWithdrawal: Number(totalWithdrawal.toFixed(2)),
    },
    deals: items,
    pagination,
  };
}
