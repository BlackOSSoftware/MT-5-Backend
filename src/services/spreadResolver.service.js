import PlanSymbolSpread from "../models/PlanSymbolSpread.model.js";

/**
 * Feature flag — when false, engine keeps legacy Instrument.spread behavior.
 * Set PLAN_SPREAD_PRICING=true to enable plan×symbol client spread.
 */
export function isPlanSpreadPricingEnabled() {
  const v = String(process.env.PLAN_SPREAD_PRICING || "false").toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export function isIbSpreadCommissionEnabled() {
  // Default: follow plan-spread flag so we don't pay IB without collecting via spread.
  if (process.env.IB_SPREAD_COMMISSION != null) {
    const v = String(process.env.IB_SPREAD_COMMISSION).toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "on";
  }
  return isPlanSpreadPricingEnabled();
}

/**
 * Compute price width from $ / lot and contractSize.
 * CLIENT_SPREAD = total_$ / contractSize
 */
export function computeClientSpreadWidth({
  houseUsdPerLot = 0,
  ibUsdPerLot = 0,
  contractSize = 1,
  override = null,
}) {
  if (typeof override === "number" && Number.isFinite(override) && override >= 0) {
    return Number(override);
  }
  const cs =
    Number.isFinite(Number(contractSize)) && Number(contractSize) > 0
      ? Number(contractSize)
      : 1;
  const total =
    Math.max(0, Number(houseUsdPerLot) || 0) +
    Math.max(0, Number(ibUsdPerLot) || 0);
  return Number((total / cs).toFixed(10));
}

export function computePipView(width, pipSize) {
  const w = Number(width);
  const p = Number(pipSize);
  if (!(Number.isFinite(w) && Number.isFinite(p) && p > 0)) return null;
  return Number((w / p).toFixed(6));
}

/**
 * Resolve spread config for an account plan + symbol.
 * Returns null when no active plan row (caller uses Instrument fallback, IB=0).
 */
export async function getPlanSymbolSpreadRow(planId, symbol) {
  if (!planId || !symbol) return null;
  const code = String(symbol).trim().toUpperCase();
  return PlanSymbolSpread.findOne({
    planId,
    symbol: code,
    isActive: true,
  }).lean();
}

/**
 * Build resolved pricing + IB budget for a trade/quote.
 *
 * @returns {{
 *   source: 'plan'|'instrument'|'none',
 *   clientSpread: number,
 *   houseUsdPerLot: number,
 *   ibUsdPerLot: number,
 *   spreadMode: string|null,
 *   row: object|null
 * }}
 */
export function resolveSpreadFromRow({
  planRow = null,
  instrumentSpread = 0,
  instrumentSpreadMode = "ADD_ON",
  contractSize = 1,
  planPricingEnabled = isPlanSpreadPricingEnabled(),
}) {
  if (planPricingEnabled && planRow) {
    const clientSpread = computeClientSpreadWidth({
      houseUsdPerLot: planRow.house_usd_per_lot,
      ibUsdPerLot: planRow.ib_usd_per_lot,
      contractSize,
      override: planRow.client_spread_override,
    });
    return {
      source: "plan",
      clientSpread,
      houseUsdPerLot: Number(planRow.house_usd_per_lot) || 0,
      ibUsdPerLot: Number(planRow.ib_usd_per_lot) || 0,
      spreadMode: instrumentSpreadMode || "ADD_ON",
      row: planRow,
    };
  }

  const fallback = Number(instrumentSpread) || 0;
  return {
    source: planPricingEnabled ? "instrument" : "instrument",
    clientSpread: fallback,
    houseUsdPerLot: 0,
    ibUsdPerLot: planPricingEnabled ? 0 : 0, // IB only from plan rows
    spreadMode: instrumentSpreadMode || "ADD_ON",
    row: null,
  };
}

/**
 * Apply half-spread to bid/ask (same math as Engine.formatPrice).
 */
export function applySpreadToQuote({
  bid,
  ask,
  clientSpread,
  spreadMode = "ADD_ON",
  spreadEnabled = true,
}) {
  let outBid = Number(bid);
  let outAsk = Number(ask);
  const spread = Number(clientSpread) || 0;

  if (
    spreadEnabled &&
    Number.isFinite(spread) &&
    spread > 0 &&
    Number.isFinite(outBid) &&
    Number.isFinite(outAsk)
  ) {
    const half = spread / 2;
    const mode = String(spreadMode || "ADD_ON").trim().toUpperCase();
    if (mode === "FIXED") {
      const mid = (outBid + outAsk) / 2;
      outBid = mid - half;
      outAsk = mid + half;
    } else {
      outBid = outBid - half;
      outAsk = outAsk + half;
    }
  }

  return { bid: outBid, ask: outAsk };
}
