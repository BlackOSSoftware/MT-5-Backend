// Chart candles: instrument resolve -> cache/provider -> aggregate.
import {
  HISTORY_TTL_SECONDS,
  LATEST_TTL_SECONDS,
  NATIVE_KLINE_TYPE,
  PROVIDER_MAX_CANDLES,
  TIMEFRAMES,
} from "./chart.constants.js";
import { aggregateCandles, baseCountFor } from "./chart.aggregator.js";
import { cacheKey, remember } from "./chart.cache.js";
import {
  rememberWorkingCode,
  resolveChartInstrument,
} from "./chart.instrument.js";
import { fetchKline } from "./chart.provider.js";

/**
 * Instrument ke candidate codes ek-ek karke try (cache key code ke hisaab
 * se). "code invalid" pe agla code; jo chala use yaad rakho.
 */
async function loadNative({ inst, base, endTs, count, ttl }) {
  let lastErr;
  for (const code of inst.codes) {
    try {
      const res = await remember(
        cacheKey({ code, base, endTs, count }),
        ttl,
        () =>
          fetchKline({
            market: inst.market,
            code,
            klineType: NATIVE_KLINE_TYPE[base],
            count,
            endTs,
          }),
      );
      rememberWorkingCode(inst.symbol, code);
      return res;
    } catch (err) {
      lastErr = err;
      if (err?.reason !== "CODE_INVALID") throw err;
    }
  }
  if (lastErr?.reason === "CODE_INVALID") {
    lastErr.message = `Chart history is not available for ${inst.symbol}`;
  }
  throw lastErr;
}

/**
 * @param {{ symbol: string, timeframe: string, limit: number, before: number|null }} q
 */
export async function getCandles({ symbol, timeframe, limit, before }) {
  const tf = TIMEFRAMES[timeframe];
  const base = tf.base;
  const baseSeconds = TIMEFRAMES[base].seconds;
  const native = base === timeframe;
  const inst = await resolveChartInstrument(symbol);

  const count = native
    ? Math.min(limit, PROVIDER_MAX_CANDLES)
    : baseCountFor({
        limit,
        targetSeconds: tf.seconds,
        baseSeconds,
        max: PROVIDER_MAX_CANDLES,
      });
  // "before" wala bucket khud shamil na ho.
  const endTs = before ? before - 1 : 0;
  const ttl = endTs ? HISTORY_TTL_SECONDS : LATEST_TTL_SECONDS[base];

  const { value: baseCandles, cached } = await loadNative({
    inst,
    base,
    endTs,
    count,
    ttl,
  });

  let candles = native ? baseCandles : aggregateCandles(baseCandles, tf.seconds);
  // Aggregate pe pehla bucket adhoora ho sakta hai (beech se shuru) - hatao.
  if (!native && candles.length > 1 && baseCandles.length >= count) {
    candles = candles.slice(1);
  }
  if (before) candles = candles.filter((k) => k.t < before);
  if (candles.length > limit) candles = candles.slice(candles.length - limit);

  return {
    symbol: inst.symbol,
    name: inst.name,
    timeframe,
    seconds: tf.seconds,
    digits: inst.digits,
    cached,
    // Isse purani history nahi (provider ne poora page nahi diya).
    hasMore: baseCandles.length >= count,
    candles,
  };
}

export function listTimeframes() {
  return Object.entries(TIMEFRAMES).map(([code, tf]) => ({
    code,
    seconds: tf.seconds,
    native: tf.base === code,
  }));
}

/**
 * Broker-scoped manual price events (admin-driven XAUUSD movements).
 * Used by the web chart to retain the movement in historical candles.
 */
export async function getManualPriceEvents({ brokerId, symbol }) {
  const ManualPriceEvent = (await import("../../models/ManualPriceEvent.model.js")).default;
  const filter = { brokerId };
  if (symbol) {
    const s = String(symbol).trim().toUpperCase();
    // XAUUSD <-> GOLD aliases
    filter.symbol =
      s === "XAUUSD" || s === "GOLD" ? { $in: ["XAUUSD", "GOLD"] } : s;
  }
  const events = await ManualPriceEvent.find(filter)
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  return events.map((e) => ({
    id: String(e._id),
    symbol: e.symbol,
    prevBid: e.prevBid,
    prevAsk: e.prevAsk,
    bid: e.bid,
    ask: e.ask,
    createdAt: e.createdAt,
  }));
}
