import PlanSymbolSpread from "../models/PlanSymbolSpread.model.js";
import Instrument from "../models/Instrument.model.js";
import {
  computeClientSpreadWidth,
  isPlanSpreadPricingEnabled,
} from "./spreadResolver.service.js";

/**
 * In-memory plan×symbol spread widths for the trade engine hot path.
 * No DB hits inside formatPrice / placeMarketOrder.
 */
const cache = new Map(); // key: `${planId}::${SYMBOL}` -> { clientSpread, houseUsdPerLot, ibUsdPerLot }

function key(planId, symbol) {
  return `${String(planId)}::${String(symbol).toUpperCase()}`;
}

export function getCachedPlanSpread(planId, symbol) {
  if (!planId || !symbol) return null;
  if (!isPlanSpreadPricingEnabled()) return null;
  return cache.get(key(planId, symbol)) || null;
}

export function setCachedPlanSpread(planId, symbol, value) {
  if (!planId || !symbol) return;
  const k = key(planId, symbol);
  if (!value || value.isActive === false) {
    cache.delete(k);
    return;
  }
  cache.set(k, {
    clientSpread: Number(value.clientSpread) || 0,
    houseUsdPerLot: Number(value.houseUsdPerLot) || 0,
    ibUsdPerLot: Number(value.ibUsdPerLot) || 0,
  });
}

export function invalidatePlanSpreadCache(planId, symbol = null) {
  if (!planId) return;
  if (symbol) {
    cache.delete(key(planId, symbol));
    return;
  }
  const prefix = `${String(planId)}::`;
  for (const k of cache.keys()) {
    if (k.startsWith(prefix)) cache.delete(k);
  }
}

export async function warmPlanSpreadMemoryCache() {
  if (!isPlanSpreadPricingEnabled()) {
    cache.clear();
    return { loaded: 0, enabled: false };
  }

  const [rows, instruments] = await Promise.all([
    PlanSymbolSpread.find({ isActive: true }).lean(),
    Instrument.find({ isActive: true }).select("code contractSize").lean(),
  ]);

  const csMap = new Map(
    instruments.map((i) => [
      String(i.code).toUpperCase(),
      Number(i.contractSize) > 0 ? Number(i.contractSize) : 1,
    ]),
  );

  cache.clear();
  for (const row of rows) {
    const symbol = String(row.symbol).toUpperCase();
    const contractSize = csMap.get(symbol) || 1;
    const clientSpread = computeClientSpreadWidth({
      houseUsdPerLot: row.house_usd_per_lot,
      ibUsdPerLot: row.ib_usd_per_lot,
      contractSize,
      override: row.client_spread_override,
    });
    setCachedPlanSpread(row.planId, symbol, {
      clientSpread,
      houseUsdPerLot: row.house_usd_per_lot,
      ibUsdPerLot: row.ib_usd_per_lot,
      isActive: true,
    });
  }

  return { loaded: cache.size, enabled: true };
}
