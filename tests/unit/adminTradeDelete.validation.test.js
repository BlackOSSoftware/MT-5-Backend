import { describe, expect, it } from "vitest";
import {
  computeDeleteBalanceDelta,
  computeRestoreBalanceDelta,
  normalizeTradeDeleteKind,
  normalizeTradeDeleteTarget,
} from "../../src/services/adminTradeDelete.validation.js";

describe("normalizeTradeDeleteKind", () => {
  it("maps live/open/closed/pending", () => {
    expect(normalizeTradeDeleteKind("live")).toBe("LIVE");
    expect(normalizeTradeDeleteKind("OPEN")).toBe("LIVE");
    expect(normalizeTradeDeleteKind("closed")).toBe("CLOSED");
    expect(normalizeTradeDeleteKind("pending")).toBe("PENDING");
  });

  it("rejects unknown kind", () => {
    expect(() => normalizeTradeDeleteKind("foo")).toThrow(/kind/i);
  });
});

describe("normalizeTradeDeleteTarget", () => {
  it("requires accountId + userId + id", () => {
    expect(() =>
      normalizeTradeDeleteTarget({ kind: "CLOSED", accountId: "a" })
    ).toThrow(/required/i);
  });

  it("accepts tradeId or positionId or orderId by kind", () => {
    expect(
      normalizeTradeDeleteTarget({
        kind: "CLOSED",
        accountId: "507f1f77bcf86cd799439011",
        userId: "507f1f77bcf86cd799439012",
        tradeId: "507f1f77bcf86cd799439013",
      }).tradeId
    ).toBe("507f1f77bcf86cd799439013");

    expect(
      normalizeTradeDeleteTarget({
        kind: "LIVE",
        accountId: "507f1f77bcf86cd799439011",
        userId: "507f1f77bcf86cd799439012",
        positionId: "pos-1",
      }).positionId
    ).toBe("pos-1");

    expect(
      normalizeTradeDeleteTarget({
        kind: "PENDING",
        accountId: "507f1f77bcf86cd799439011",
        userId: "507f1f77bcf86cd799439012",
        orderId: "ord-1",
      }).orderId
    ).toBe("ord-1");
  });
});

describe("computeDeleteBalanceDelta / computeRestoreBalanceDelta", () => {
  it("never changes balance (user must not notice delete)", () => {
    expect(computeDeleteBalanceDelta("CLOSED", 40)).toBe(0);
    expect(computeDeleteBalanceDelta("CLOSED", -15)).toBe(0);
    expect(computeDeleteBalanceDelta("LIVE", 99)).toBe(0);
    expect(computeDeleteBalanceDelta("PENDING", 10)).toBe(0);
  });

  it("restore also leaves balance untouched", () => {
    expect(computeRestoreBalanceDelta(-40)).toBe(0);
    expect(computeRestoreBalanceDelta(0)).toBe(0);
  });
});
