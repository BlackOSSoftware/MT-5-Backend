import crypto from "crypto";
import { HighLowService } from "./highlow.service.js";
import {
  findInstrumentByAnySymbol,
  resolveInstrumentProviderCode,
} from "./instrumentProvider.service.js";
import { tradeEngine } from "../trade-engine/bootstrap.js";

/**
 * AllTick feed market: forex / metal / indices / crypto → crypto REST,
 * equities → stock REST (same as chart + WS).
 */
const feedMarketForSegment = (segment) => {
  const s = String(segment || "").trim().toLowerCase();
  if (s === "stock" || s === "stocks" || s === "equity" || s === "equities") {
    return "stock";
  }
  return "crypto";
};

const restBase = (feedMarket) =>
  String(
    feedMarket === "stock"
      ? process.env.ALLTICK_STOCK_REST_URL || ""
      : process.env.ALLTICK_CRYPTO_REST_URL || "",
  ).trim();

const token = () => String(process.env.ALLTICK_API_KEY || "").trim();

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Daily OHLC via GET /kline (chart-style) — fallback when batch-kline 429s. */
const fetchDailyKline = async (feedMarket, code) => {
  const base = restBase(feedMarket);
  const key = token();
  if (!base || !key || !code) return null;

  const query = encodeURIComponent(
    JSON.stringify({
      trace: `mktstat-kline-${crypto.randomUUID()}`,
      data: {
        code,
        kline_type: 8,
        kline_timestamp_end: 0,
        query_kline_num: 2,
        adjust_type: 0,
      },
    }),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${base}/kline?token=${key}&query=${query}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.ret !== 200) return null;
    const list = json?.data?.kline_list;
    if (!Array.isArray(list) || list.length === 0) return null;
    // AllTick returns newest first or last — pick the latest by timestamp.
    const bars = [...list].sort(
      (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0),
    );
    const item = bars[0];
    const open = num(item?.open_price);
    const high = num(item?.high_price);
    const low = num(item?.low_price);
    const close = num(item?.close_price);
    if (!open && !high && !low && !close) return null;
    return {
      open,
      high,
      low,
      close,
      source: "alltick_daily_kline",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Last trade tick (weekend-friendly). Often only `price`, no bid/ask. */
const fetchAlltickTradeTick = async (feedMarket, code) => {
  const base = restBase(feedMarket);
  const key = token();
  if (!base || !key || !code) return null;

  const query = encodeURIComponent(
    JSON.stringify({
      trace: `mktstat-${crypto.randomUUID()}`,
      data: { symbol_list: [{ code }] },
    }),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`${base}/trade-tick?token=${key}&query=${query}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.ret !== 200) return null;
    const row = json?.data?.tick_list?.[0] || null;
    if (!row) return null;
    const bid = num(row.bid_price ?? row.bid);
    const ask = num(row.ask_price ?? row.ask);
    const price = num(row.price ?? row.last_price ?? row.close);
    return {
      bid: bid ?? price,
      ask: ask ?? price,
      price,
      source: "alltick_trade_tick",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Market Statistics page: Alltick daily OHLC + live / last bid-ask.
 */
export const getMarketStatisticsService = async (symbolRaw) => {
  const symbol = String(symbolRaw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!symbol) throw new Error("symbol is required");

  const instrument = await findInstrumentByAnySymbol(symbol);
  const code = instrument?.code || symbol;
  const segment = instrument?.segment || "FOREX";
  const feedMarket = feedMarketForSegment(segment);
  const providerCode =
    (await resolveInstrumentProviderCode(code).catch(() => null)) || code;

  const [hlRes, tick] = await Promise.all([
    HighLowService.getDayHighLow(feedMarket, providerCode).catch(() => null),
    fetchAlltickTradeTick(feedMarket, providerCode),
  ]);

  // If provider code failed, retry HighLow with app code once.
  let hl = hlRes?.data || null;
  if (!hl && providerCode !== code) {
    const retry = await HighLowService.getDayHighLow(feedMarket, code).catch(
      () => null,
    );
    hl = retry?.data || null;
  }
  // batch-kline rate-limit / miss → GET /kline fallback
  if (!hl) {
    hl =
      (await fetchDailyKline(feedMarket, providerCode)) ||
      (providerCode !== code ? await fetchDailyKline(feedMarket, code) : null);
  }

  const open = num(hl?.open);
  const high = num(hl?.high);
  const low = num(hl?.low);
  const close = num(hl?.close);

  const eng = tradeEngine.symbols.get(code) || tradeEngine.symbols.get(symbol);
  let bid = num(eng?.bid) || num(tick?.bid);
  let ask = num(eng?.ask) || num(tick?.ask);

  // Still missing → use last daily close as display price.
  if (!bid && close) bid = close;
  if (!ask && close) ask = close;
  if (!bid && tick?.price) bid = tick.price;
  if (!ask && tick?.price) ask = tick.price;

  // Alltick daily kline is mid/trade OHLC — use as bid/ask high-low base;
  // app live ticks refine bidHigh/askHigh further while market is open.
  const bidHigh = high || bid;
  const bidLow = low || bid;
  const askHigh = high || ask;
  const askLow = low || ask;

  // Day change vs open (MT5-style); fall back to close if open missing.
  const ref = open || close;
  const priceChangePct =
    ref && bid ? Number((((bid - ref) / ref) * 100).toFixed(4)) : null;

  let source = hl?.source || null;
  if (num(eng?.bid)) source = source ? `${source}+engine` : "engine";
  else if (tick?.source) source = source ? `${source}+tick` : tick.source;

  return {
    symbol: code,
    name: instrument?.name || code,
    segment,
    digits: Number(instrument?.pricePrecision) || 5,
    bid,
    ask,
    bidHigh: bidHigh || null,
    bidLow: bidLow || null,
    askHigh: askHigh || null,
    askLow: askLow || null,
    open: open || null,
    close: close || null,
    priceChangePct,
    source,
  };
};
