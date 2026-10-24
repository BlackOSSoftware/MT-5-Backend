import Instrument from "../models/Instrument.model.js";
import Account from "../models/Account.model.js";
import { findInstrumentByAnySymbol } from "./instrumentProvider.service.js";
import { marketService } from "./market.service.js";
import redis, { isRedisReady } from "../config/redis.js";

const CACHE_TTL_SECONDS = 60;
const PROPERTY_CACHE_PREFIX = "property:v1:";
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const cacheKey = (symbol, accountId) =>
  `${PROPERTY_CACHE_PREFIX}${String(accountId)}:${String(symbol).toUpperCase()}`;

const getRedisJSON = async (key) => {
  if (!isRedisReady()) return null;
  try {
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const setRedisJSON = async (key, value, ttlSeconds) => {
  if (!isRedisReady()) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // cache miss is fine — DB path still works
  }
};

/** Admin ne schedule badla to property page turant naya time dikhaye. */
export const invalidatePropertyCache = async () => {
  if (!isRedisReady()) return 0;
  let removed = 0;
  try {
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${PROPERTY_CACHE_PREFIX}*`,
        "COUNT",
        100,
      );
      cursor = next;
      if (keys?.length) {
        removed += await redis.del(...keys);
      }
    } while (cursor !== "0");
  } catch {
    return removed;
  }
  return removed;
};

/** Admin segment aliases (indexes) <-> instrument segments (indices). */
const scheduleSegmentCandidates = (segmentRaw) => {
  const seg = String(segmentRaw || "").trim().toLowerCase();
  if (!seg) return [];
  const aliases = {
    indexes: ["indexes", "indices", "index"],
    indices: ["indices", "indexes", "index"],
    index: ["index", "indices", "indexes"],
  };
  return [...new Set(aliases[seg] || [seg])];
};

const fmtNum = (value, { precision, fallback = "—" } = {}) => {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (typeof precision === "number") return n.toFixed(precision);
  return Number.isInteger(n) ? String(n) : String(n);
};

const titleCaseSegment = (segment) => {
  const s = String(segment || "").trim().toUpperCase();
  return {
    FOREX: "Currency",
    METAL: "Metals",
    METALS: "Metals",
    INDEX: "Indexes",
    INDICES: "Indexes",
    INDEXES: "Indexes",
    CRYPTO: "Crypto",
    ENERGY: "Energy",
    COMMODITY: "Commodities",
    COMMODITIES: "Commodities",
    STOCK: "Stock",
    NASDAQ: "Nasdaq",
    ETF: "ETF",
  }[s] || (s ? s[0] + s.slice(1).toLowerCase() : "Other");
};

const calculationLabel = (segment) => {
  const s = String(segment || "").trim().toUpperCase();
  return {
    FOREX: "Forex",
    METAL: "Metals",
    METALS: "Metals",
    CRYPTO: "Crypto",
    INDEX: "CFD",
    INDICES: "CFD",
    INDEXES: "CFD",
    ENERGY: "CFD",
    COMMODITY: "CFD",
    STOCK: "CFD",
  }[s] || titleCaseSegment(segment);
};

const exchangeLabel = (instrument) => {
  const segment = String(instrument.segment || "").toUpperCase();
  if (segment === "FOREX") return "XCCY";
  if (instrument.providerCode) return String(instrument.providerCode);
  return segment || "—";
};

/** Forex pair currencies from code (USDJPY -> USD / JPY). */
const forexCurrencies = (code, segment) => {
  const raw = String(code || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  if (String(segment || "").toUpperCase() === "FOREX" && raw.length >= 6) {
    return { base: raw.slice(0, 3), quote: raw.slice(3, 6) };
  }
  if (raw.length >= 6) {
    return { base: raw.slice(0, 3), quote: raw.slice(3, 6) };
  }
  return { base: "USD", quote: "USD" };
};

const volumeStep = (instrument) => {
  if (instrument.minQty != null) return instrument.minQty;
  const prec = Number(instrument.qtyPrecision);
  if (Number.isFinite(prec) && prec >= 0) return Number((10 ** -prec).toFixed(prec));
  return instrument.lotSize ?? 0.01;
};

const marginTiers = () => [
  { range: "0 - 300 000", initial: "1.0000000", maintenance: "1.0000000" },
  {
    range: "300 000 - 500 000",
    initial: "2.0000000",
    maintenance: "2.0000000",
  },
  {
    range: "500 000 - 10 000 000",
    initial: "2.0000000",
    maintenance: "2.0000000",
  },
];

const infoUrlForSymbol = (symbol, segment) => {
  const code = String(symbol || "").toLowerCase();
  const seg = String(segment || "").toUpperCase();
  if (seg === "FOREX" || seg === "METAL" || seg === "METALS") {
    return `https://www.mql5.com/en/quotes/currencies/${code}`;
  }
  if (seg === "CRYPTO") {
    return `https://www.mql5.com/en/quotes/crypto/${code}`;
  }
  return `https://www.mql5.com/en/search#!keyword=${encodeURIComponent(symbol)}`;
};

/**
 * Optional Alltick live tick — fills digits/spread when broker DB is thin.
 * Failures are ignored; property page still renders from Instrument.
 */
const fetchAlltickTick = async (instrument) => {
  const token = String(process.env.ALLTICK_API_KEY || "").trim();
  if (!token) return null;

  const segment = String(instrument.segment || "").toUpperCase();
  const isCrypto = segment === "CRYPTO";
  const base = String(
    isCrypto
      ? process.env.ALLTICK_CRYPTO_REST_URL || ""
      : process.env.ALLTICK_STOCK_REST_URL || "",
  ).trim();
  if (!base) return null;

  const code = String(instrument.providerCode || instrument.code || "")
    .trim()
    .replace(/[^A-Za-z0-9.]/g, "");
  if (!code) return null;

  const query = encodeURIComponent(
    JSON.stringify({
      trace: `property-${Date.now()}`,
      data: { symbol_list: [{ code }] },
    }),
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(`${base}/trade-tick?token=${token}&query=${query}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    const row = json?.data?.tick_list?.[0] || json?.data?.[0] || null;
    if (!row) return null;
    const bid = Number(row.bid_price ?? row.bid ?? row.price);
    const ask = Number(row.ask_price ?? row.ask ?? row.price);
    return {
      bid: Number.isFinite(bid) ? bid : null,
      ask: Number.isFinite(ask) ? ask : null,
      source: "alltick",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Normalize admin time strings to HH:mm for property UI. */
const toHHMM = (value, fallback = "00:00") => {
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const m24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) return `${String(Number(m24[1])).padStart(2, "0")}:${m24[2]}`;

  const m12 = raw.match(/^(\d{1,2}):([0-5]\d)\s*([AaPp][Mm])$/);
  if (m12) {
    let h = Number(m12[1]);
    const min = m12[2];
    const mer = m12[3].toLowerCase();
    if (h < 1 || h > 12) return fallback;
    if (h === 12) h = 0;
    if (mer === "pm") h += 12;
    return `${String(h).padStart(2, "0")}:${min}`;
  }

  return fallback;
};

/**
 * Admin Market Settings → Quotes/Trades Sessions rows.
 * weeklyOff days blank; dayOverrides (e.g. Saturday early close) applied per day.
 * open===close (admin 00:00–00:00) shows as 00:00-24:00 like MT5 24h session.
 */
const buildSessions = (schedule) => {
  const off = new Set(
    (schedule?.weeklyOff || []).map((d) => String(d).toUpperCase()),
  );
  const baseOpen = toHHMM(schedule?.openTime, "00:00");
  const baseClose = toHHMM(schedule?.closeTime, "00:00");
  const overrides =
    schedule?.dayOverrides && typeof schedule.dayOverrides === "object"
      ? schedule.dayOverrides
      : {};

  return DAYS.map((day) => {
    const key = day.toUpperCase();
    if (off.has(key)) return { day, session: "" };

    const ov = overrides[key] || {};
    const open = toHHMM(ov.openTime, baseOpen);
    let close = toHHMM(ov.closeTime, baseClose);
    if (open === close) close = "24:00";

    return { day, session: `${open}-${close}` };
  });
};

const buildPage = (instrument, account, schedule, alltick) => {
  const { base, quote } = forexCurrencies(instrument.code, instrument.segment);
  const contractSize = Number(instrument.contractSize) || 100000;
  const digits =
    Number(instrument.pricePrecision) ||
    (alltick?.bid != null
      ? String(alltick.bid).split(".")[1]?.length || 0
      : 5);
  const spread =
    instrument.spread_mode === "FIXED"
      ? fmtNum(instrument.spread)
      : "Floating";

  const rows = [
    { label: "Exchange", value: exchangeLabel(instrument) },
    { label: "Sector", value: titleCaseSegment(instrument.segment) },
    { label: "Digits", value: fmtNum(digits, { precision: 0 }) },
    { label: "Contract size", value: fmtNum(contractSize) },
    { label: "Spread", value: spread },
    { label: "Stop levels", value: "0" },
    { label: "Margin currency", value: base },
    { label: "Profit currency", value: quote },
    { label: "Calculation", value: calculationLabel(instrument.segment) },
    { label: "Hedged margin", value: fmtNum(contractSize) },
    {
      label: "Trade",
      value: instrument.isTradeable === false ? "Disabled" : "Full access",
    },
    { label: "Chart mode", value: "By bid price" },
    { label: "Execution", value: "Market Execution" },
    { label: "GTC mode", value: "Good till cancelled" },
    { label: "Fill policy", value: "Fill or Kill" },
    { label: "Expiration", value: "GTC, Today, Specified" },
    { label: "Orders", value: "All" },
    {
      label: "Minimal volume",
      value: fmtNum(instrument.minQty ?? instrument.lotSize),
    },
    { label: "Maximal volume", value: fmtNum(instrument.maxQty) },
    { label: "Volume step", value: fmtNum(volumeStep(instrument)) },
    { label: "Swap long", value: fmtNum(instrument.swapLong ?? 0) },
    { label: "Swap short", value: fmtNum(instrument.swapShort ?? 0) },
  ];

  const swapRates = [
    { day: "Monday", multiplier: "1" },
    { day: "Tuesday", multiplier: "1" },
    { day: "Wednesday", multiplier: "3" },
    { day: "Thursday", multiplier: "1" },
    { day: "Friday", multiplier: "1" },
  ];

  const tiers = marginTiers().map((t) => ({
    range: t.range,
    value: `${t.initial} / ${t.maintenance}`,
  }));

  const sessions = buildSessions(schedule);

  return {
    symbol: instrument.code,
    name: instrument.name || instrument.code,
    description: instrument.name || instrument.code,
    infoUrl: infoUrlForSymbol(instrument.code, instrument.segment),
    properties: rows,
    swapRates,
    margin: {
      type: `Floating, notional value per symbol, ${base}`,
      showUsdPerLotDefault: true,
      marketBuy: tiers,
      marketSell: tiers,
    },
    quotesSessions: sessions,
    tradesSessions: sessions,
    swapCharges: {
      enabled: !!account?.swap_enabled,
      charge: account?.swap_charge ?? null,
    },
    alltick: alltick
      ? { bid: alltick.bid, ask: alltick.ask, source: alltick.source }
      : null,
  };
};

const getMarketScheduleBySegment = async (segmentRaw) => {
  for (const seg of scheduleSegmentCandidates(segmentRaw)) {
    const result = await marketService.getSchedule(seg);
    if (!result?.error && result?.data) return result.data;
  }
  return null;
};

export const getPropertyBySymbolService = async (symbolRaw, accountId) => {
  const symbol = String(symbolRaw || "").trim();

  if (!symbol) {
    throw new Error("symbol is required");
  }

  if (!accountId) {
    throw new Error("accountId is required");
  }

  const key = cacheKey(symbol, accountId);
  const cached = await getRedisJSON(key);
  if (cached) {
    return { ...cached, cached: true };
  }

  const [instrumentMatch, account] = await Promise.all([
    findInstrumentByAnySymbol(symbol),
    Account.findById(accountId).select("swap_enabled swap_charge").lean(),
  ]);

  const instrument = instrumentMatch
    ? await Instrument.findOne({ code: instrumentMatch.code }).select("-_id").lean()
    : null;

  if (!instrument) {
    throw new Error("Instrument not found");
  }

  if (!account) {
    throw new Error("Account not found");
  }

  const [marketSchedule, alltick] = await Promise.all([
    getMarketScheduleBySegment(instrument.segment),
    fetchAlltickTick(instrument),
  ]);

  // Same source as Admin → Market Settings (Redis/DB). Fallback only if missing.
  const schedule =
    marketSchedule ||
    ({
      segment: String(instrument.segment || "").toLowerCase(),
      timezone: "Asia/Kolkata",
      openTime: "00:00",
      closeTime: "00:00",
      weeklyOff: ["SATURDAY", "SUNDAY"],
      holidays: [],
      dayOverrides: {},
    });

  const page = buildPage(instrument, account, schedule, alltick);

  const payload = {
    instrument,
    swapCharges: page.swapCharges,
    marketSchedule: schedule,
    page,
    cached: false,
  };

  await setRedisJSON(key, payload, CACHE_TTL_SECONDS);
  return payload;
};
