import { describe, it, expect } from "vitest";
import {
  computeClientSpreadWidth,
  applySpreadToQuote,
  resolveSpreadFromRow,
} from "../../src/services/spreadResolver.service.js";

describe("spreadResolver", () => {
  it("converts $ / lot to bid-ask width via contractSize", () => {
    // XAUUSD: $55 / lot, CS=100 → width 0.55
    const width = computeClientSpreadWidth({
      houseUsdPerLot: 20,
      ibUsdPerLot: 35,
      contractSize: 100,
    });
    expect(width).toBeCloseTo(0.55, 10);
  });

  it("uses override when provided", () => {
    const width = computeClientSpreadWidth({
      houseUsdPerLot: 20,
      ibUsdPerLot: 35,
      contractSize: 100,
      override: 0.1,
    });
    expect(width).toBe(0.1);
  });

  it("applies half-half ADD_ON without double counting", () => {
    const { bid, ask } = applySpreadToQuote({
      bid: 3964,
      ask: 3964,
      clientSpread: 0.05,
      spreadMode: "ADD_ON",
      spreadEnabled: true,
    });
    expect(ask - bid).toBeCloseTo(0.05, 10);
    expect(bid).toBeCloseTo(3963.975, 6);
    expect(ask).toBeCloseTo(3964.025, 6);
  });

  it("FIXED mode uses mid ± half", () => {
    const { bid, ask } = applySpreadToQuote({
      bid: 100,
      ask: 102,
      clientSpread: 2,
      spreadMode: "FIXED",
      spreadEnabled: true,
    });
    expect(bid).toBe(100); // mid 101 - 1
    expect(ask).toBe(102); // mid 101 + 1
  });

  it("plan row resolution exposes IB budget; missing row IB=0", () => {
    const withRow = resolveSpreadFromRow({
      planRow: {
        house_usd_per_lot: 5,
        ib_usd_per_lot: 2.5,
        client_spread_override: null,
      },
      instrumentSpread: 10,
      contractSize: 100,
      planPricingEnabled: true,
    });
    expect(withRow.source).toBe("plan");
    expect(withRow.clientSpread).toBeCloseTo(0.075, 10);
    expect(withRow.ibUsdPerLot).toBe(2.5);

    const missing = resolveSpreadFromRow({
      planRow: null,
      instrumentSpread: 10,
      contractSize: 100,
      planPricingEnabled: true,
    });
    expect(missing.source).toBe("instrument");
    expect(missing.clientSpread).toBe(10);
    expect(missing.ibUsdPerLot).toBe(0);
  });

  it("when plan pricing disabled, keeps instrument spread", () => {
    const r = resolveSpreadFromRow({
      planRow: {
        house_usd_per_lot: 5,
        ib_usd_per_lot: 2.5,
      },
      instrumentSpread: 10,
      contractSize: 100,
      planPricingEnabled: false,
    });
    expect(r.clientSpread).toBe(10);
  });
});
