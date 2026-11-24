import { tradeEngine } from "../trade-engine/bootstrap.js";
import { symbolsMatch } from "../trade-engine/Engine.js";
import ManualPriceEvent from "../models/ManualPriceEvent.model.js";
import { broadcastManualPriceToBroker } from "../ws/alltick.ws.js";

/** Resolve the engine symbol key for a requested symbol (XAUUSD/GOLD aliases only). */
function resolveEngineSymbol(symbol) {
  const s = String(symbol || "").trim().toUpperCase();
  if (!s) return null;
  const isGold = s === "XAUUSD" || s === "GOLD";
  const candidates = isGold ? ["XAUUSD", "GOLD"] : [s];
  for (const key of candidates) {
    if (tradeEngine.symbols?.has(key)) return key;
  }
  if (isGold) {
    for (const [k] of tradeEngine.symbols?.entries() || []) {
      if (symbolsMatch(k, s)) return k;
    }
  }
  return null;
}

/** List all symbols known to the trading engine (for admin symbol picker). */
function listEngineSymbols() {
  const keys = tradeEngine.symbols ? Array.from(tradeEngine.symbols.keys()) : [];
  return keys.map((k) => String(k).toUpperCase()).sort();
}

function countPositionsForBroker(brokerId, symbol) {
  let checked = 0;
  let open = 0;
  const accountIds = new Set();
  for (const account of tradeEngine.accounts.values()) {
    if (String(account.brokerId || "") !== String(brokerId)) continue;
    for (const pos of account.positions?.values() || []) {
      if (symbolsMatch(pos.symbol, symbol)) {
        checked++;
        open++;
        accountIds.add(String(account.accountId));
      }
    }
  }
  return { checked, open, accountIds };
}

/**
 * Execute a broker-scoped manual price movement.
 * - Does NOT touch global symbol prices (updateGlobal: false).
 * - Only accounts whose brokerId matches are ticked by the engine.
 * - SL/TP/pending evaluation, balance/equity/margin updates and trade
 *   history all go through the existing engine path.
 */
export async function executeManualPrice({ adminUser, brokerId, symbol, price }) {
  const engineSymbol = resolveEngineSymbol(symbol);
  if (!engineSymbol) {
    throw Object.assign(new Error("Symbol not available in trading engine"), { status: 400 });
  }

  const target = Number(price);
  if (!Number.isFinite(target) || target <= 0) {
    throw Object.assign(new Error("Invalid price"), { status: 400 });
  }

  const sym = tradeEngine.symbols.get(engineSymbol);
  const prevBid = Number(sym?.bid ?? sym?.rawBid) || null;
  const prevAsk = Number(sym?.ask ?? sym?.rawAsk) || null;

  const before = countPositionsForBroker(brokerId, engineSymbol);

  // bid = ask = target: deterministic SL evaluation at the exact price the
  // admin entered (BUY SL checks bid, SELL SL checks ask).
  await tradeEngine.onTick(engineSymbol, target, target, {
    brokerId: String(brokerId),
    updateGlobal: false,
  });

  const after = countPositionsForBroker(brokerId, engineSymbol);
  const positionsClosed = Math.max(0, before.open - after.open);
  const affectedAccounts = before.accountIds;

  const event = await ManualPriceEvent.create({
    brokerId,
    symbol: engineSymbol,
    prevBid,
    prevAsk,
    bid: target,
    ask: target,
    adminId: adminUser?._id || null,
    adminEmail: adminUser?.email || null,
    positionsChecked: before.checked,
    positionsClosed,
    affectedAccounts: affectedAccounts.size,
  });

  // Web chart live update — only this broker's clients.
  let wsSent = 0;
  try {
    const res = broadcastManualPriceToBroker({
      symbol: engineSymbol,
      bid: target,
      ask: target,
      brokerId,
    });
    wsSent = res?.sent || 0;
  } catch (err) {
    console.error("[MANUAL_PRICE] WS broadcast failed", err?.message || err);
  }

  return {
    eventId: event._id,
    symbol: engineSymbol,
    previousPrice: prevBid ?? prevAsk,
    newPrice: target,
    positionsChecked: before.checked,
    positionsClosed,
    affectedAccounts: affectedAccounts.size,
    clientsNotified: wsSent,
    executedAt: event.createdAt,
  };
}

/** Audit list for the authorized admin (broker-scoped). */
export async function listManualPriceEvents({ brokerId, symbol, limit = 50 }) {
  const filter = { brokerId };
  if (symbol) {
    const engineSymbol = resolveEngineSymbol(symbol) || symbol;
    filter.symbol = engineSymbol;
  }
  const events = await ManualPriceEvent.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 50, 1), 200))
    .lean();
  return events;
}

export { listEngineSymbols };
