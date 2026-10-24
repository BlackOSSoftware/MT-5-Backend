/**
 * Pure helpers for admin trade edit payloads (unit-testable).
 * undefined = leave unchanged; null = clear (SL/TP); number = set.
 */

export function parseOptionalNumber(value, fieldName) {
  if (value === undefined) return { kind: "omit" };
  if (value === null || value === "") return { kind: "clear" };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return { kind: "set", value: n };
}

export function resolveOptionalField(parsed, current) {
  if (parsed.kind === "omit") return current;
  if (parsed.kind === "clear") return null;
  return parsed.value;
}

export function requirePositiveNumber(value, fieldName) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid ${fieldName}`);
  }
  return n;
}

export function computeBalanceDelta(oldRealizedPnL, newRealizedPnL) {
  const oldPnl = Number(oldRealizedPnL) || 0;
  const newPnl = Number(newRealizedPnL) || 0;
  if (!Number.isFinite(oldPnl) || !Number.isFinite(newPnl)) {
    throw new Error("Invalid realizedPnL for balance delta");
  }
  return Number((newPnl - oldPnl).toFixed(8));
}

export function applyBalanceDelta(currentBalance, delta) {
  const bal = Number(currentBalance) || 0;
  const d = Number(delta) || 0;
  return Number(Math.max(0, bal + d).toFixed(8));
}

/**
 * Normalize live position modify body.
 * At least one editable field must be present.
 */
export function normalizeLivePositionEdit(body = {}) {
  const volume = parseOptionalNumber(body.volume, "volume");
  const openPrice = parseOptionalNumber(body.openPrice, "openPrice");
  const stopLoss = parseOptionalNumber(body.stopLoss, "stopLoss");
  const takeProfit = parseOptionalNumber(body.takeProfit, "takeProfit");

  const any =
    volume.kind !== "omit" ||
    openPrice.kind !== "omit" ||
    stopLoss.kind !== "omit" ||
    takeProfit.kind !== "omit";

  if (!any) {
    throw new Error(
      "At least one of volume, openPrice, stopLoss, takeProfit is required"
    );
  }

  if (volume.kind === "set" && volume.value <= 0) {
    throw new Error("Invalid volume");
  }
  if (openPrice.kind === "set" && openPrice.value <= 0) {
    throw new Error("Invalid openPrice");
  }
  if (volume.kind === "clear" || openPrice.kind === "clear") {
    throw new Error("volume and openPrice cannot be cleared");
  }

  return { volume, openPrice, stopLoss, takeProfit };
}

export function normalizePendingOrderEdit(body = {}) {
  const volume = parseOptionalNumber(body.volume, "volume");
  const price = parseOptionalNumber(body.price, "price");
  const stopLoss = parseOptionalNumber(body.stopLoss, "stopLoss");
  const takeProfit = parseOptionalNumber(body.takeProfit, "takeProfit");

  const any =
    volume.kind !== "omit" ||
    price.kind !== "omit" ||
    stopLoss.kind !== "omit" ||
    takeProfit.kind !== "omit";

  if (!any) {
    throw new Error(
      "At least one of volume, price, stopLoss, takeProfit is required"
    );
  }

  if (volume.kind === "set" && volume.value <= 0) {
    throw new Error("Invalid volume");
  }
  if (price.kind === "set" && price.value <= 0) {
    throw new Error("Invalid price");
  }
  if (volume.kind === "clear" || price.kind === "clear") {
    throw new Error("volume and price cannot be cleared");
  }

  return { volume, price, stopLoss, takeProfit };
}

export const CLOSED_TRADE_CLOSE_REASONS = [
  "MANUAL",
  "MANUAL_CLOSE",
  "STOP_LOSS",
  "TAKE_PROFIT",
  "STOP_OUT",
  "SYSTEM",
  "TRADE",
];

/** Map legacy / free-text close reasons onto Trade schema enum values. */
export function normalizeCloseReasonValue(value) {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;

  const raw = String(value).trim().toUpperCase().replace(/[\s-]+/g, "_");
  const aliases = {
    MANUAL: "MANUAL",
    MANUAL_CLOSE: "MANUAL",
    CLOSE: "MANUAL",
    USER: "MANUAL",
    ADMIN: "MANUAL",
    STOP_LOSS: "STOP_LOSS",
    SL: "STOP_LOSS",
    TAKE_PROFIT: "TAKE_PROFIT",
    TP: "TAKE_PROFIT",
    STOP_OUT: "STOP_OUT",
    STOPOUT: "STOP_OUT",
    MARGIN: "STOP_OUT",
    SYSTEM: "SYSTEM",
    TRADE: "TRADE",
  };

  const mapped = aliases[raw];
  if (mapped) return mapped;

  if (CLOSED_TRADE_CLOSE_REASONS.includes(raw)) {
    return raw === "MANUAL_CLOSE" ? "MANUAL" : raw;
  }

  throw new Error(
    `Invalid closeReason. Allowed: MANUAL, STOP_LOSS, TAKE_PROFIT, STOP_OUT, SYSTEM, TRADE`
  );
}

export function normalizeClosedTradeEdit(body = {}) {
  const fields = [
    "volume",
    "openPrice",
    "closePrice",
    "stopLoss",
    "takeProfit",
    "commission",
    "spread",
    "swap",
    "realizedPnL",
  ];

  const parsed = {};
  let any = false;

  for (const field of fields) {
    const p = parseOptionalNumber(body[field], field);
    parsed[field] = p;
    if (p.kind !== "omit") any = true;
  }

  let closeReason = undefined;
  if (body.closeReason !== undefined) {
    any = true;
    const normalized = normalizeCloseReasonValue(body.closeReason);
    if (normalized === null) {
      closeReason = { kind: "clear" };
    } else {
      closeReason = { kind: "set", value: normalized };
    }
  }

  if (!any) {
    throw new Error("At least one editable closed-trade field is required");
  }

  for (const field of ["volume", "openPrice", "closePrice"]) {
    if (parsed[field].kind === "clear") {
      throw new Error(`${field} cannot be cleared`);
    }
    if (parsed[field].kind === "set" && parsed[field].value <= 0) {
      throw new Error(`Invalid ${field}`);
    }
  }

  return { ...parsed, closeReason };
}

export function mergeClosedTradeFields(existing, normalized) {
  const next = { ...existing };

  const applyNum = (key, allowNull = false) => {
    const p = normalized[key];
    if (!p || p.kind === "omit") return;
    if (p.kind === "clear") {
      next[key] = allowNull ? null : next[key];
      return;
    }
    next[key] = p.value;
  };

  applyNum("volume");
  applyNum("openPrice");
  applyNum("closePrice");
  applyNum("stopLoss", true);
  applyNum("takeProfit", true);
  applyNum("commission");
  applyNum("spread");
  applyNum("swap");
  applyNum("realizedPnL");

  if (normalized.closeReason) {
    if (normalized.closeReason.kind === "clear") next.closeReason = null;
    else if (normalized.closeReason.kind === "set") {
      next.closeReason = normalized.closeReason.value;
    }
  }

  return next;
}

/** Engine-style price PnL for a closed trade (before commission). */
export function computeClosedTradeGrossPnL({
  side,
  volume,
  openPrice,
  closePrice,
  contractSize = 1,
}) {
  const vol = Number(volume);
  const open = Number(openPrice);
  const close = Number(closePrice);
  const csRaw = Number(contractSize);
  const cs = Number.isFinite(csRaw) && csRaw > 0 ? csRaw : 1;

  if (!Number.isFinite(vol) || !Number.isFinite(open) || !Number.isFinite(close)) {
    throw new Error("Invalid prices/volume for PnL");
  }

  const diff =
    String(side || "").toUpperCase() === "SELL" ? open - close : close - open;
  return Number((diff * vol * cs).toFixed(8));
}

/**
 * If volume/open/close changed, PnL must follow prices (ignore stale form PnL).
 * Otherwise keep explicit realizedPnL override when provided.
 */
export function resolveClosedTradePnL({
  side,
  volume,
  openPrice,
  closePrice,
  contractSize,
  normalized,
  previousRealizedPnL,
}) {
  const structuralChanged =
    normalized.volume?.kind === "set" ||
    normalized.openPrice?.kind === "set" ||
    normalized.closePrice?.kind === "set";

  const grossPnL = computeClosedTradeGrossPnL({
    side,
    volume,
    openPrice,
    closePrice,
    contractSize,
  });

  if (structuralChanged) {
    return { grossPnL, realizedPnL: grossPnL, auto: true };
  }

  if (normalized.realizedPnL?.kind === "set") {
    return {
      grossPnL,
      realizedPnL: Number(normalized.realizedPnL.value),
      auto: false,
    };
  }

  return {
    grossPnL,
    realizedPnL: Number(previousRealizedPnL) || 0,
    auto: false,
  };
}
