import Trade from "../models/Trade.model.js";
import PendingOrder from "../models/PendingOrder.model.js";
import { ensureServerSubscriptions } from "../ws/alltick.ws.js";

/**
 * Keeps upstream price feeds subscribed for every symbol that has an open position
 * or pending order, so the engine always has live bid/ask (SL/TP checks, admin reports)
 * even when no client is watching that symbol.
 */
const INTERVAL_MS = 60_000;
let timer = null;

async function warmOnce() {
  try {
    const [openSymbols, pendingSymbols] = await Promise.all([
      Trade.distinct("symbol", { status: "OPEN", isDeleted: { $ne: true } }),
      PendingOrder.distinct("symbol", { status: "PENDING", isDeleted: { $ne: true } }),
    ]);
    await ensureServerSubscriptions([...openSymbols, ...pendingSymbols]);
  } catch (err) {
    console.warn("[PRICE_WARM] failed:", err?.message || err);
  }
}

export function startPriceWarmJob() {
  if (timer) return;
  void warmOnce();
  timer = setInterval(warmOnce, INTERVAL_MS);
  timer.unref?.();
}
