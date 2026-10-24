// src/services/highlow.service.js
import crypto from "crypto";
import dotenv from "dotenv";
import {
  normalizeProviderCode,
  resolveInstrumentProviderCode,
} from "./instrumentProvider.service.js";

dotenv.config();

const ALLTICK_TOKEN = String(process.env.ALLTICK_API_KEY || "").trim();

// REST base URLs (same as AllTick docs)
const REST_CRYPTO_BASE = String(process.env.ALLTICK_CRYPTO_REST_URL || "").trim();
const REST_STOCK_BASE = String(process.env.ALLTICK_STOCK_REST_URL || "").trim();

// ✅ Redis default export
import redis, { isRedisReady } from "../config/redis.js";

const normalizeMarket = (v) => String(v || "").trim().toLowerCase();

const makeKey = (market, symbol) => {
  // v2: close = previous session close (for day change), not today's live close
  return `dayhl:v2:${normalizeMarket(market)}:${normalizeProviderCode(symbol)}`;
};

const getDayStringIST = () => {
  // IST = UTC + 5:30
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const istDate = new Date(istMs);

  const yyyy = istDate.getUTCFullYear();
  const mm = String(istDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(istDate.getUTCDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}`;
};

const safeNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const getBatchKlineUrl = (market) => {
  if (!ALLTICK_TOKEN) return null;

  if (market === "crypto") {
    if (!REST_CRYPTO_BASE) return null;
    return `${REST_CRYPTO_BASE}/batch-kline?token=${ALLTICK_TOKEN}`;
  }

  if (market === "stock") {
    if (!REST_STOCK_BASE) return null;
    return `${REST_STOCK_BASE}/batch-kline?token=${ALLTICK_TOKEN}`;
  }

  return null;
};

const buildTrace = () => {
  const rand = crypto.randomUUID();
  const ts = Date.now();

  return `${rand}-${ts}`;
};

// In-flight locks
const inflight = new Map();

const fetchDayHighLowFromAllTick = async (market, symbol) => {
  const m = normalizeMarket(market);
  const s = normalizeProviderCode(symbol);

  const url = getBatchKlineUrl(m);

  if (!url) {
    return {
      error: {
        status: 500,
        message: "AllTick REST URL or token missing",
      },
    };
  }

  // Daily Kline = 8 — need 2 bars: today (OHL) + previous day (close for change %)
  const body = {
    trace: buildTrace(),
    data: {
      data_list: [
        {
          code: s,
          kline_type: 8,
          kline_timestamp_end: 0,
          query_kline_num: 2,
          adjust_type: 0,
        },
      ],
    },
  };

  let resp;

  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      error: { status: 500, message: "Failed to call AllTick API" },
    };
  }

  let json;

  try {
    json = await resp.json();
  } catch {
    return {
      error: { status: 500, message: "Invalid AllTick response" },
    };
  }

  if (!json || json.ret !== 200) {
    return {
      error: {
        status: 500,
        message: "AllTick returned error",
        details: json,
      },
    };
  }

  const klineList = json?.data?.kline_list;

  if (!Array.isArray(klineList) || klineList.length === 0) {
    return {
      error: { status: 404, message: "No kline data returned" },
    };
  }

  const klineData = klineList[0]?.kline_data;

  if (!Array.isArray(klineData) || klineData.length === 0) {
    return {
      error: { status: 404, message: "No kline_data returned" },
    };
  }

  // Newest first by timestamp (AllTick order varies).
  const bars = [...klineData].sort(
    (a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0),
  );
  const today = bars[0];
  const prev = bars[1] || null;

  const open = safeNumber(today?.open_price);
  const high = safeNumber(today?.high_price);
  const low = safeNumber(today?.low_price);
  const todayClose = safeNumber(today?.close_price);
  // Previous session close — used for absolute + % day change on quotes.
  const previousClose =
    safeNumber(prev?.close_price) ??
    safeNumber(today?.open_price) ??
    todayClose;

  if (
    open === null ||
    high === null ||
    low === null ||
    previousClose === null
  ) {
    return {
      error: {
        status: 500,
        message: "Invalid OHLC values from AllTick",
      },
    };
  }

  return {
    data: {
      market: m,
      symbol: s,
      day: getDayStringIST(),
      open,
      high,
      low,
      // `close` kept as previousClose so existing dayClose consumers stay correct
      close: previousClose,
      previousClose,
      todayClose,
      source: "alltick_daily_kline",
      updatedAt: Date.now(),
    },
  };
};

export const HighLowService = {
  async getDayHighLow(market, symbol) {
    const m = normalizeMarket(market);
    const s = await resolveInstrumentProviderCode(symbol);

    if (!m || !s) {
      return {
        error: { status: 400, message: "market and symbol required" },
      };
    }

    const redisKey = makeKey(m, s);

    // 1) Redis Cache
    if (isRedisReady()) {
      try {
        const cachedRaw = await redis.get(redisKey);

        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw);
          const today = getDayStringIST();

          const o = safeNumber(cached?.open);
          const h = safeNumber(cached?.high);
          const l = safeNumber(cached?.low);
          const c = safeNumber(cached?.close);

          if (
            cached?.day === today &&
            o !== null &&
            h !== null &&
            l !== null &&
            c !== null
          ) {
            return { data: cached };
          }
        }
      } catch {
        // ignore cache error
      }
    }

    // 2) In-flight protection
    const inflightKey = `${m}:${s}`;

    const existing = inflight.get(inflightKey);

    if (existing) {
      return existing;
    }

    const p = (async () => {
      const res = await fetchDayHighLowFromAllTick(m, s);

      // cache 26 hours
      if (res?.data && isRedisReady()) {
        try {
          await redis.set(
            redisKey,
            JSON.stringify(res.data),
            "EX",
            26 * 60 * 60
          );
        } catch {}
      }

      return res;
    })();

    inflight.set(inflightKey, p);

    try {
      return await p;
    } finally {
      inflight.delete(inflightKey);
    }
  },

  async resetDayHighLow(market, symbol) {
    const m = normalizeMarket(market);
    const s = await resolveInstrumentProviderCode(symbol);

    if (!m || !s) {
      return {
        error: { status: 400, message: "market and symbol required" },
      };
    }

    if (!isRedisReady()) {
      return {
        error: { status: 503, message: "Redis not ready" },
      };
    }

    const redisKey = makeKey(m, s);

    try {
      await redis.del(redisKey);

      return {
        data: {
          market: m,
          symbol: s,
          reset: true,
        },
      };
    } catch {
      return {
        error: { status: 500, message: "Failed to reset high/low" },
      };
    }
  },

  async resetAllDayHighLow() {
    if (!isRedisReady()) {
      return {
        error: { status: 503, message: "Redis not ready" },
      };
    }

    let cursor = "0";
    let deleted = 0;

    try {
      do {
        const reply = await redis.scan(
          cursor,
          "MATCH",
          "dayhl:*",
          "COUNT",
          "200" // includes dayhl:v2:*
        );

        const nextCursor = Array.isArray(reply)
          ? String(reply[0] || "0")
          : "0";

        const keys = Array.isArray(reply) ? reply[1] : [];

        cursor = nextCursor;

        if (Array.isArray(keys) && keys.length > 0) {
          await redis.del(...keys);
          deleted += keys.length;
        }
      } while (cursor !== "0");

      return { data: { deleted } };
    } catch {
      return {
        error: { status: 500, message: "Failed to reset all high/low" },
      };
    }
  },
};
