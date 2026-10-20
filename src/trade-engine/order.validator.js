// NOTE:
// - Market open/close checks are enforced inside the trade-engine (Engine) using an in-memory
//   market status cache populated by the market cron (no Redis/DB calls on the order path).
// - This validator stays pure and only validates order price rules (SL/TP vs bid/ask).
export function validateOrder({
  side,
  orderType,
  price,
  limitPrice,
  stopLoss,
  takeProfit,
  bid,
  ask,
}) {
  const buyPrice = ask;
  const sellPrice = bid;

  /* ================= MARKET ================= */

  if (!orderType || orderType === "MARKET") {
    if (side === "BUY") {
      if (stopLoss !== null && stopLoss >= buyPrice) {
        throw new Error("Stop loss must be below current price");
      }

      if (takeProfit !== null && takeProfit <= buyPrice) {
        throw new Error("Take profit must be above current price");
      }
    }

    if (side === "SELL") {
      if (stopLoss !== null && stopLoss <= sellPrice) {
        throw new Error("Stop loss must be above current price");
      }

      if (takeProfit !== null && takeProfit >= sellPrice) {
        throw new Error("Take profit must be below current price");
      }
    }

    return;
  }

  /* ================= PENDING ================= */

  switch (orderType) {
    case "BUY_LIMIT":
      if (price >= buyPrice) {
        throw new Error("BUY LIMIT must be below market price");
      }

      if (stopLoss !== null && stopLoss >= price) {
        throw new Error("Stop loss must be below limit price");
      }

      if (takeProfit !== null && takeProfit <= price) {
        throw new Error("Take profit must be above limit price");
      }
      break;

    case "SELL_LIMIT":
      if (price <= sellPrice) {
        throw new Error("SELL LIMIT must be above market price");
      }

      if (stopLoss !== null && stopLoss <= price) {
        throw new Error("Stop loss must be above limit price");
      }

      if (takeProfit !== null && takeProfit >= price) {
        throw new Error("Take profit must be below limit price");
      }
      break;

    case "BUY_STOP":
      if (price <= buyPrice) {
        throw new Error("BUY STOP must be above market price");
      }

      if (stopLoss !== null && stopLoss >= price) {
        throw new Error("Stop loss must be below stop price");
      }

      if (takeProfit !== null && takeProfit <= price) {
        throw new Error("Take profit must be above stop price");
      }
      break;

    case "SELL_STOP":
      if (price >= sellPrice) {
        throw new Error("SELL STOP must be below market price");
      }

      if (stopLoss !== null && stopLoss <= price) {
        throw new Error("Stop loss must be above stop price");
      }

      if (takeProfit !== null && takeProfit >= price) {
        throw new Error("Take profit must be below stop price");
      }
      break;

    case "BUY_STOP_LIMIT": {
      if (price <= buyPrice) {
        throw new Error("BUY STOP LIMIT stop price must be above market price");
      }
      const lp = Number(limitPrice);
      if (!Number.isFinite(lp) || lp <= 0) {
        throw new Error("Limit price is required for STOP LIMIT orders");
      }
      if (lp >= price) {
        throw new Error("Limit price must be below stop price");
      }
      if (stopLoss !== null && stopLoss >= lp) {
        throw new Error("Stop loss must be below limit price");
      }
      if (takeProfit !== null && takeProfit <= lp) {
        throw new Error("Take profit must be above limit price");
      }
      break;
    }

    case "SELL_STOP_LIMIT": {
      if (price >= sellPrice) {
        throw new Error("SELL STOP LIMIT stop price must be below market price");
      }
      const lp = Number(limitPrice);
      if (!Number.isFinite(lp) || lp <= 0) {
        throw new Error("Limit price is required for STOP LIMIT orders");
      }
      if (lp <= price) {
        throw new Error("Limit price must be above stop price");
      }
      if (stopLoss !== null && stopLoss <= lp) {
        throw new Error("Stop loss must be above limit price");
      }
      if (takeProfit !== null && takeProfit >= lp) {
        throw new Error("Take profit must be below limit price");
      }
      break;
    }

    default:
      throw new Error("Invalid order type");
  }
}
