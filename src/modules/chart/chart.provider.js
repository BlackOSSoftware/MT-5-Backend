// AllTick REST kline client (sirf chart module ke liye).
import crypto from "crypto";

import {
  PROVIDER_MAX_CANDLES,
  PROVIDER_MIN_INTERVAL_MS,
  PROVIDER_TIMEOUT_MS,
} from "./chart.constants.js";

const token = () => String(process.env.ALLTICK_API_KEY || "").trim();

const baseUrl = (market) =>
  String(
    market === "stock"
      ? process.env.ALLTICK_STOCK_REST_URL || ""
      : process.env.ALLTICK_CRYPTO_REST_URL || "",
  ).trim();

export class ChartProviderError extends Error {
  constructor(message, status = 502, reason = "") {
    super(message);
    this.name = "ChartProviderError";
    this.status = status;
    /** "CODE_INVALID" = AllTick ne symbol code nahi pehchana (ret 600). */
    this.reason = reason;
  }
}

/* ---------------- rate-limited queue ----------------
 * AllTick ~1 request/second deta hai; saare chart calls ek line me,
 * har call ke beech PROVIDER_MIN_INTERVAL_MS gap.
 */
let chain = Promise.resolve();
let lastCallAt = 0;

function schedule(task) {
  const run = chain.then(async () => {
    const wait = lastCallAt + PROVIDER_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallAt = Date.now();
    return task();
  });
  // Ek call fail ho to bhi agle calls chalte rahein.
  chain = run.catch(() => {});
  return run;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** AllTick kline_data -> [{ t (unix sec), o, h, l, c, v }] (purane se naye). */
function normalize(list) {
  const out = [];
  for (const k of list || []) {
    const t = num(k?.timestamp);
    const o = num(k?.open_price);
    const h = num(k?.high_price);
    const l = num(k?.low_price);
    const c = num(k?.close_price);
    if (t === null || o === null || h === null || l === null || c === null) {
      continue;
    }
    out.push({ t, o, h, l, c, v: num(k?.volume) ?? 0 });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function requestOnce({ market, code, klineType, count, endTs }) {
  const base = baseUrl(market);
  if (!base || !token()) {
    throw new ChartProviderError("Chart data provider is not configured", 500);
  }
  const query = encodeURIComponent(
    JSON.stringify({
      trace: `${crypto.randomUUID()}-${Date.now()}`,
      data: {
        code,
        kline_type: klineType,
        kline_timestamp_end: endTs || 0,
        query_kline_num: Math.min(count, PROVIDER_MAX_CANDLES),
        adjust_type: 0,
      },
    }),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  let json;
  try {
    const resp = await fetch(`${base}/kline?token=${token()}&query=${query}`, {
      signal: controller.signal,
    });
    json = await resp.json();
  } catch (err) {
    throw new ChartProviderError(
      err?.name === "AbortError"
        ? "Chart data provider timeout"
        : "Chart data provider unreachable",
    );
  } finally {
    clearTimeout(timer);
  }

  if (!json || json.ret !== 200) {
    const invalid = json?.ret === 600 || /code invalid/i.test(json?.msg || "");
    throw new ChartProviderError(
      `Chart data provider error${json?.msg ? `: ${json.msg}` : ""}`,
      invalid ? 404 : 502,
      invalid ? "CODE_INVALID" : "",
    );
  }
  return normalize(json?.data?.kline_list);
}

/**
 * Ek native timeframe ke candles. Rate limit / temporary error pe ek
 * baar retry (queue ke through, isliye apne aap gap milta hai).
 */
export async function fetchKline(params) {
  try {
    return await schedule(() => requestOnce(params));
  } catch (err) {
    // Config / galat code pe retry ka fayda nahi.
    if (
      err instanceof ChartProviderError &&
      (err.status === 500 || err.reason === "CODE_INVALID")
    ) {
      throw err;
    }
    return schedule(() => requestOnce(params));
  }
}
