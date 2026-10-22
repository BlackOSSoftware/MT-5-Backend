// GET /v1/chart/candles query validation.
import {
  DEFAULT_LIMIT,
  DEFAULT_TIMEFRAME,
  MAX_LIMIT,
  TIMEFRAMES,
} from "./chart.constants.js";

export class ChartValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChartValidationError";
    this.status = 400;
  }
}

/**
 * @returns {{ symbol: string, timeframe: string, limit: number, before: number|null }}
 *   before = unix seconds - isse pehle ke candles (purani history scroll).
 */
export function parseCandlesQuery(query = {}) {
  const symbol = String(query.symbol || "")
    .trim()
    .toUpperCase();
  if (!symbol || !/^[A-Z0-9._/-]{2,20}$/.test(symbol)) {
    throw new ChartValidationError("Valid symbol is required");
  }

  const timeframe = String(query.timeframe || query.tf || DEFAULT_TIMEFRAME)
    .trim()
    .toUpperCase();
  if (!TIMEFRAMES[timeframe]) {
    throw new ChartValidationError(
      `Invalid timeframe. Use one of: ${Object.keys(TIMEFRAMES).join(", ")}`,
    );
  }

  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined && query.limit !== "") {
    limit = Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new ChartValidationError("limit must be a positive integer");
    }
    limit = Math.min(limit, MAX_LIMIT);
  }

  let before = null;
  if (query.before !== undefined && query.before !== "") {
    before = Number(query.before);
    if (!Number.isFinite(before) || before <= 0) {
      throw new ChartValidationError("before must be a unix timestamp (seconds)");
    }
    before = Math.floor(before);
  }

  return { symbol, timeframe, limit, before };
}
