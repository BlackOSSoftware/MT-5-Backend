import crypto from "crypto";
import { HighLowService } from "./highlow.service.js";
import {
  findInstrumentByAnySymbol,
  resolveInstrumentProviderCode,
} from "./instrumentProvider.service.js";
import { tradeEngine } from "../trade-engine/bootstrap.js";

/**
 * Last display price for watchlist when live ticks are missing
 * (weekend / closed / AllTick 605). Always AllTick → backend only.
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

const fetchTradeTick = async (feedMarket, code) => {
  const base = restBase(feedMarket);
  const key = token();
  if (!base || !key || !code) return null;

  const query = encodeURIComponent(
    JSON.stringify({
      trace: `seed-tick-${crypto.randomUUID()}`,
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
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const fetchDailyKline = async (feedMarket, code) => {
  const base = restBase(feedMarket);
  const key = token();
  if (!base || !key || !code) return null;

  const query = encodeURIComponent(
    JSON.stringify({
      trace: `seed-kline-${crypto.randomUUID()}`,
      data: {
        code,
        kline_type: 8,
        kline_timestamp_end: 0,
        query_kline_num: 1,
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
    const item = list[0];
    return {
      open: num(item?.open_price),
      high: num(item?.high_price),
      low: num(item?.low_price),
      close: num(item?.close_price),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * @returns {{ bid, ask, dayOpen, dayHigh, dayLow, dayClose } | null}
 */
export async function resolveSeedQuote(symbolRaw) {
  const symbol = String(symbolRaw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!symbol) return null;

  const instrument = await findInstrumentByAnySymbol(symbol).catch(() => null);
  const code = instrument?.code || symbol;
  const segment = instrument?.segment || "FOREX";
  const feedMarket = feedMarketForSegment(segment);
  const providerCode =
    (await resolveInstrumentProviderCode(code).catch(() => null)) || code;

  // App code + provider (case-sensitive: AllTick wants "Silver" not SILVER/XAGUSD).
  const codes = [
    ...new Set(
      [
        providerCode,
        code,
        symbol,
        // known AllTick metal alias
        code === "SILVER" || symbol === "SILVER" || providerCode === "XAGUSD"
          ? "Silver"
          : null,
      ].filter(Boolean),
    ),
  ];

  let hl = null;
  for (const c of codes) {
    const res = await HighLowService.getDayHighLow(feedMarket, c).catch(
      () => null,
    );
    if (res?.data?.close) {
      hl = res.data;
      break;
    }
  }

  if (!hl) {
    for (const c of codes) {
      const k = await fetchDailyKline(feedMarket, c);
      if (k?.close) {
        hl = k;
        break;
      }
    }
  }

  let tick = null;
  for (const c of codes) {
    tick = await fetchTradeTick(feedMarket, c);
    if (tick?.price || tick?.bid) break;
    tick = null;
  }

  const eng =
    tradeEngine.symbols?.get(code) ||
    tradeEngine.symbols?.get(symbol) ||
    tradeEngine.symbols?.get(providerCode);

  const close = num(hl?.close);
  const open = num(hl?.open);
  let bid = num(eng?.bid) || num(tick?.bid) || close || num(tick?.price);
  let ask = num(eng?.ask) || num(tick?.ask) || close || num(tick?.price);

  if (!bid && !ask) return null;

  if (!bid) bid = ask;
  if (!ask) ask = bid;

  return {
    bid,
    ask,
    dayOpen: open || null,
    dayHigh: num(hl?.high) || null,
    dayLow: num(hl?.low) || null,
    dayClose: close || bid,
  };
}
