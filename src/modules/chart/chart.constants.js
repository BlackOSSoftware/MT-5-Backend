// Chart module - timeframes, AllTick kline types, limits, cache TTLs.

/**
 * AllTick REST kline_type -> native (provider) timeframes.
 * Baaki MT5 timeframes inhi se aggregate hote hain.
 */
export const NATIVE_KLINE_TYPE = Object.freeze({
  M1: 1,
  M5: 2,
  M15: 3,
  M30: 4,
  H1: 5,
  H2: 6,
  H4: 7,
  D1: 8,
  W1: 9,
  MN: 10,
});

const MIN = 60;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * MT5 ke saare timeframes. `base` = kis native frame se banta hai,
 * `seconds` = ek candle ki lambai (MN / W1 calendar based, native hi).
 */
export const TIMEFRAMES = Object.freeze({
  M1: { seconds: MIN, base: "M1" },
  M2: { seconds: 2 * MIN, base: "M1" },
  M3: { seconds: 3 * MIN, base: "M1" },
  M4: { seconds: 4 * MIN, base: "M1" },
  M5: { seconds: 5 * MIN, base: "M5" },
  M6: { seconds: 6 * MIN, base: "M1" },
  M10: { seconds: 10 * MIN, base: "M5" },
  M12: { seconds: 12 * MIN, base: "M1" },
  M15: { seconds: 15 * MIN, base: "M15" },
  M20: { seconds: 20 * MIN, base: "M5" },
  M30: { seconds: 30 * MIN, base: "M30" },
  H1: { seconds: HOUR, base: "H1" },
  H2: { seconds: 2 * HOUR, base: "H2" },
  H3: { seconds: 3 * HOUR, base: "H1" },
  H4: { seconds: 4 * HOUR, base: "H4" },
  H6: { seconds: 6 * HOUR, base: "H2" },
  H8: { seconds: 8 * HOUR, base: "H4" },
  H12: { seconds: 12 * HOUR, base: "H4" },
  D1: { seconds: DAY, base: "D1" },
  W1: { seconds: 7 * DAY, base: "W1" },
  MN: { seconds: 30 * DAY, base: "MN" },
});

export const DEFAULT_TIMEFRAME = "M5";
export const DEFAULT_LIMIT = 300;
export const MAX_LIMIT = 1000;

/** AllTick ek request me itne hi candles deta hai. */
export const PROVIDER_MAX_CANDLES = 1000;

/**
 * Latest candles (end = now) ka cache - chhote frames jaldi expire.
 * Live candle app khud ticks se update karta hai, isliye thoda purana
 * cache bhi chalega.
 */
export const LATEST_TTL_SECONDS = Object.freeze({
  M1: 15,
  M5: 30,
  M15: 60,
  M30: 90,
  H1: 120,
  H2: 300,
  H4: 300,
  D1: 900,
  W1: 1800,
  MN: 3600,
});

/** Purani (band ho chuki) history badalti nahi - lamba cache. */
export const HISTORY_TTL_SECONDS = 6 * 60 * 60;

/** Redis band ho to process memory cache me max itne entries. */
export const MEMORY_CACHE_MAX_ENTRIES = 300;

/** AllTick REST rate limit (~1 req/sec) - har call ke beech kam se kam itna gap. */
export const PROVIDER_MIN_INTERVAL_MS = Number(
  process.env.ALLTICK_REST_MIN_INTERVAL_MS || 1100,
);

export const PROVIDER_TIMEOUT_MS = 10_000;

export const CACHE_KEY_PREFIX = "chart:v1";
