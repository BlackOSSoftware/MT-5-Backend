import mongoose from "mongoose";
import Trade from "../models/Trade.model.js";
import Account from "../models/Account.model.js";
import User from "../models/User.model.js";
import { tradeEngine } from "../trade-engine/bootstrap.js";
import { applyBrokerUserIdMatch } from "../utils/brokerScope.js";
import { getLastFeedQuote } from "../ws/alltick.ws.js";

/**
 * Read-only Client Position report for a broker admin.
 *
 * Reads live prices / floating PnL from the in-memory trade engine and closed
 * PnL from Mongo. It never writes to the engine or to any trade.
 */

const round = (n, dp = 2) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

function resolveRange({ from, to } = {}) {
  const now = new Date();
  const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = to ? new Date(to) : now;
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid from/to date");
  }
  return { start, end };
}

const positiveOrNull = (n) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** Quotes older than this are treated as stale (feed paused / market closed). */
const FEED_QUOTE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Live engine quote for a symbol (same prices clients trade on). Falls back to the
 * last raw feed quote for symbols the engine has not loaded.
 */
function liveQuote(symbol) {
  const sym = tradeEngine.symbols.get(symbol);
  const bid = positiveOrNull(sym?.bid);
  const ask = positiveOrNull(sym?.ask);
  if (bid || ask) return { bid, ask };
  const feed = getLastFeedQuote(symbol);
  if (feed && Date.now() - feed.at < FEED_QUOTE_MAX_AGE_MS) {
    return { bid: positiveOrNull(feed.bid), ask: positiveOrNull(feed.ask) };
  }
  return { bid: null, ask: null };
}

/** Live mark price for closing a position: BUY closes at bid, SELL at ask. */
function livePrice(symbol, side) {
  const q = liveQuote(symbol);
  return side === "BUY" ? q.bid : q.ask;
}

function contractSizeOf(trade) {
  const sym = tradeEngine.symbols.get(trade.symbol);
  const cs = Number(sym?.contractSize ?? trade.contractSize);
  return Number.isFinite(cs) && cs > 0 ? cs : 1;
}

/** Engine floating PnL when the position is loaded; otherwise compute from the live price. */
function floatingPnLOf(trade, price, cs) {
  const acc = tradeEngine.accounts.get(String(trade.accountId));
  const pos = acc?.positions?.get(String(trade.positionId));
  const engineHasPrice = positiveOrNull(tradeEngine.symbols.get(trade.symbol)?.bid) != null;
  if (pos && engineHasPrice && Number.isFinite(Number(pos.floatingPnL))) return Number(pos.floatingPnL);
  if (price == null) return 0;
  const diff = trade.side === "BUY" ? price - trade.openPrice : trade.openPrice - price;
  return diff * trade.volume * cs;
}

/**
 * Money lost if the stop loss is hit (0 when the SL already locks in profit).
 * Returns null when no SL is set.
 */
function slRiskAmount(trade, cs) {
  const sl = Number(trade.stopLoss);
  if (!Number.isFinite(sl) || sl <= 0) return null;
  const loss = trade.side === "BUY" ? trade.openPrice - sl : sl - trade.openPrice;
  return Math.max(loss, 0) * trade.volume * cs;
}

export async function clientPositionReportService({ brokerId, from, to, accountType = "live" } = {}) {
  const { start, end } = resolveRange({ from, to });

  const openMatch = { status: "OPEN", isDeleted: { $ne: true } };
  const closedMatch = {
    status: "CLOSED",
    isDeleted: { $ne: true },
    closeTime: { $gte: start, $lte: end },
  };
  await applyBrokerUserIdMatch(openMatch, brokerId, "userId");
  await applyBrokerUserIdMatch(closedMatch, brokerId, "userId");

  const [openTrades, closedTrades] = await Promise.all([
    Trade.find(openMatch)
      .select(
        "positionId ticket userId accountId symbol side volume openPrice stopLoss takeProfit contractSize openTime commission swap spread",
      )
      .lean(),
    Trade.find(closedMatch)
      .select("accountId symbol realizedPnL commission spread volume")
      .lean(),
  ]);

  const accountIds = [
    ...new Set([...openTrades, ...closedTrades].map((t) => String(t.accountId))),
  ].filter((id) => mongoose.isValidObjectId(id));

  const accounts = await Account.find({ _id: { $in: accountIds } })
    .select("_id user_id account_number account_type balance")
    .lean();
  const accountById = new Map(accounts.map((a) => [String(a._id), a]));

  const wantType = String(accountType || "live").toLowerCase();
  const includeAccount = (accountId) => {
    if (wantType === "all") return true;
    const acc = accountById.get(String(accountId));
    return String(acc?.account_type || "live").toLowerCase() === wantType;
  };

  const open = openTrades.filter((t) => includeAccount(t.accountId));
  const closed = closedTrades.filter((t) => includeAccount(t.accountId));

  const userIds = [...new Set(open.map((t) => String(t.userId)))].filter((id) =>
    mongoose.isValidObjectId(id),
  );
  const users = await User.find({ _id: { $in: userIds } }).select("_id name email").lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const scripts = new Map();
  const script = (symbol) => {
    if (!scripts.has(symbol)) {
      scripts.set(symbol, {
        symbol,
        longLots: 0,
        shortLots: 0,
        longValue: 0,
        shortValue: 0,
        openPositions: 0,
        clientFloating: 0,
        closedProfit: 0,
        closedLoss: 0,
        closedTrades: 0,
        commission: 0,
        spreadPoints: 0,
        spreadVolume: 0,
        bid: null,
        ask: null,
      });
    }
    return scripts.get(symbol);
  };

  const positions = open.map((t) => {
    const cs = contractSizeOf(t);
    const price = livePrice(t.symbol, t.side);
    const floating = floatingPnLOf(t, price, cs);
    const acc = accountById.get(String(t.accountId));
    const engineAcc = tradeEngine.accounts.get(String(t.accountId));
    const equity = Number(engineAcc?.equity ?? acc?.balance ?? 0);
    const riskAmount = slRiskAmount(t, cs);
    const user = userById.get(String(t.userId));

    const s = script(t.symbol);
    const quote = liveQuote(t.symbol);
    s.bid = quote.bid ?? s.bid;
    s.ask = quote.ask ?? s.ask;
    s.openPositions += 1;
    s.clientFloating += floating;
    s.commission += Number(t.commission) || 0;
    const sp = Number(t.spread) || 0;
    if (sp > 0) {
      s.spreadPoints += sp * t.volume;
      s.spreadVolume += t.volume;
    }
    if (t.side === "BUY") {
      s.longLots += t.volume;
      s.longValue += t.volume * t.openPrice;
    } else {
      s.shortLots += t.volume;
      s.shortValue += t.volume * t.openPrice;
    }

    return {
      positionId: t.positionId,
      ticket: t.ticket ?? null,
      userId: String(t.userId),
      userName: user?.name || "",
      userEmail: user?.email || "",
      accountId: String(t.accountId),
      accountNumber: acc?.account_number || "",
      accountType: acc?.account_type || "",
      symbol: t.symbol,
      side: t.side,
      volume: t.volume,
      contractSize: cs,
      openPrice: t.openPrice,
      currentPrice: price,
      bid: quote.bid,
      ask: quote.ask,
      stopLoss: Number(t.stopLoss) > 0 ? Number(t.stopLoss) : null,
      takeProfit: Number(t.takeProfit) > 0 ? Number(t.takeProfit) : null,
      floatingPnL: round(floating),
      equity: round(equity),
      riskAmount: riskAmount == null ? null : round(riskAmount),
      /** % of account equity lost if the SL is hit; null = no SL (unlimited risk). */
      riskPercent: riskAmount == null || !(equity > 0) ? null : round((riskAmount / equity) * 100),
      /** Current drawdown of this position as % of equity (0 when in profit). */
      drawdownPercent: equity > 0 && floating < 0 ? round((-floating / equity) * 100) : 0,
      openTime: t.openTime,
    };
  });

  for (const t of closed) {
    const s = script(t.symbol);
    const pnl = Number(t.realizedPnL) || 0;
    s.closedTrades += 1;
    s.commission += Number(t.commission) || 0;
    const sp = Number(t.spread) || 0;
    if (sp > 0) {
      s.spreadPoints += sp * (Number(t.volume) || 0);
      s.spreadVolume += Number(t.volume) || 0;
    }
    if (pnl >= 0) s.closedProfit += pnl;
    else s.closedLoss += -pnl;
  }

  const rows = [...scripts.values()]
    .map((s) => {
      const closedNet = s.closedProfit - s.closedLoss;
      // Broker is the counterparty: client gains are broker losses and vice versa.
      // Commission charged to clients is broker income on top of the P/L side.
      const brokerNet = -(s.clientFloating + closedNet) + s.commission;
      const quote = s.bid == null && s.ask == null ? liveQuote(s.symbol) : { bid: s.bid, ask: s.ask };
      return {
        symbol: s.symbol,
        bid: quote.bid,
        ask: quote.ask,
        openPositions: s.openPositions,
        longLots: round(s.longLots, 2),
        shortLots: round(s.shortLots, 2),
        netLots: round(s.longLots - s.shortLots, 2),
        longAvg: s.longLots > 0 ? s.longValue / s.longLots : null,
        shortAvg: s.shortLots > 0 ? s.shortValue / s.shortLots : null,
        clientFloating: round(s.clientFloating),
        closedTrades: s.closedTrades,
        closedProfit: round(s.closedProfit),
        closedLoss: round(s.closedLoss),
        brokerProfit: round(Math.max(brokerNet, 0)),
        brokerLoss: round(Math.max(-brokerNet, 0)),
        brokerNet: round(brokerNet),
        commission: round(s.commission),
        /** Volume-weighted average spread in points across open + closed trades. */
        spreadAvg: s.spreadVolume > 0 ? round(s.spreadPoints / s.spreadVolume, 1) : null,
      };
    })
    .sort((a, b) => b.longLots + b.shortLots - (a.longLots + a.shortLots));

  const sum = (key) => round(rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0));
  const totals = {
    openPositions: positions.length,
    longLots: sum("longLots"),
    shortLots: sum("shortLots"),
    clientFloating: sum("clientFloating"),
    closedProfit: sum("closedProfit"),
    closedLoss: sum("closedLoss"),
    brokerNet: sum("brokerNet"),
    commission: sum("commission"),
    positionsWithoutSl: positions.filter((p) => p.stopLoss == null).length,
  };

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    accountType: wantType,
    totals,
    scripts: rows,
    positions,
    generatedAt: new Date().toISOString(),
  };
}
