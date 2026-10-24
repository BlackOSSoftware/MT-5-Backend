import { describe, expect, it } from "vitest";
import {
  applyBalanceDelta,
  computeBalanceDelta,
  mergeClosedTradeFields,
  normalizeCloseReasonValue,
  normalizeClosedTradeEdit,
  normalizeLivePositionEdit,
  normalizePendingOrderEdit,
  parseOptionalNumber,
  resolveClosedTradePnL,
  resolveOptionalField,
} from "../../src/services/adminTradeEdit.validation.js";

describe("parseOptionalNumber / resolveOptionalField", () => {
  it("omits undefined", () => {
    expect(parseOptionalNumber(undefined, "x")).toEqual({ kind: "omit" });
  });

  it("clears null or empty string", () => {
    expect(parseOptionalNumber(null, "x")).toEqual({ kind: "clear" });
    expect(parseOptionalNumber("", "x")).toEqual({ kind: "clear" });
  });

  it("sets finite numbers", () => {
    expect(parseOptionalNumber("12.5", "x")).toEqual({
      kind: "set",
      value: 12.5,
    });
  });

  it("rejects invalid numbers", () => {
    expect(() => parseOptionalNumber("abc", "volume")).toThrow(/volume/i);
  });

  it("resolve keeps / clears / sets", () => {
    expect(resolveOptionalField({ kind: "omit" }, 10)).toBe(10);
    expect(resolveOptionalField({ kind: "clear" }, 10)).toBeNull();
    expect(resolveOptionalField({ kind: "set", value: 3 }, 10)).toBe(3);
  });
});

describe("computeBalanceDelta / applyBalanceDelta", () => {
  it("computes new - old", () => {
    expect(computeBalanceDelta(100, 150)).toBe(50);
    expect(computeBalanceDelta(100, 40)).toBe(-60);
  });

  it("floors balance at zero", () => {
    expect(applyBalanceDelta(20, -50)).toBe(0);
    expect(applyBalanceDelta(100, 25)).toBe(125);
  });
});

describe("normalizeLivePositionEdit", () => {
  it("requires at least one field", () => {
    expect(() => normalizeLivePositionEdit({})).toThrow(/at least one/i);
  });

  it("accepts volume and openPrice", () => {
    const n = normalizeLivePositionEdit({ volume: 0.02, openPrice: 100 });
    expect(n.volume).toEqual({ kind: "set", value: 0.02 });
    expect(n.openPrice).toEqual({ kind: "set", value: 100 });
  });

  it("allows clearing SL/TP", () => {
    const n = normalizeLivePositionEdit({ stopLoss: null, takeProfit: "" });
    expect(n.stopLoss.kind).toBe("clear");
    expect(n.takeProfit.kind).toBe("clear");
  });

  it("rejects clearing volume", () => {
    expect(() => normalizeLivePositionEdit({ volume: null })).toThrow(
      /cannot be cleared/i
    );
  });
});

describe("normalizePendingOrderEdit", () => {
  it("accepts volume + price", () => {
    const n = normalizePendingOrderEdit({ volume: 1, price: 1.2 });
    expect(n.volume.value).toBe(1);
    expect(n.price.value).toBe(1.2);
  });
});

describe("normalizeClosedTradeEdit / mergeClosedTradeFields", () => {
  it("merges realizedPnL and clears SL", () => {
    const normalized = normalizeClosedTradeEdit({
      realizedPnL: 55,
      stopLoss: null,
    });
    const next = mergeClosedTradeFields(
      {
        volume: 1,
        openPrice: 10,
        closePrice: 11,
        stopLoss: 9,
        takeProfit: 12,
        commission: 0,
        spread: 0,
        swap: 0,
        realizedPnL: 10,
        closeReason: "MANUAL",
      },
      normalized
    );
    expect(next.realizedPnL).toBe(55);
    expect(next.stopLoss).toBeNull();
  });

  it("maps MANUAL_CLOSE to MANUAL", () => {
    expect(normalizeCloseReasonValue("MANUAL_CLOSE")).toBe("MANUAL");
    const normalized = normalizeClosedTradeEdit({
      closeReason: "MANUAL_CLOSE",
    });
    expect(normalized.closeReason).toEqual({ kind: "set", value: "MANUAL" });
  });
});

describe("resolveClosedTradePnL", () => {
  it("recalculates when close price changes even if stale PnL sent", () => {
    const normalized = normalizeClosedTradeEdit({
      closePrice: 12,
      realizedPnL: 999,
    });
    const result = resolveClosedTradePnL({
      side: "BUY",
      volume: 1,
      openPrice: 10,
      closePrice: 12,
      contractSize: 1,
      normalized,
      previousRealizedPnL: 10,
    });
    expect(result.realizedPnL).toBe(2);
    expect(result.auto).toBe(true);
  });
});
