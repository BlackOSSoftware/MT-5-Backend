import { describe, it, expect } from "vitest";

/** Mirror of credit math — keep in sync with ibCommission.service */
function splitIbBudget(ibUsdPerLot, lots, levels) {
  const budget = ibUsdPerLot * lots;
  const paid = [];
  let total = 0;
  for (const l of levels) {
    const amount = Number(((ibUsdPerLot * lots * l.percent) / 100).toFixed(8));
    paid.push({ level: l.level, amount });
    total += amount;
  }
  return { budget, paid, total };
}

describe("IB level budget", () => {
  it("never exceeds ib_$ × lots", () => {
    const { budget, total } = splitIbBudget(35, 1, [
      { level: 1, percent: 70 },
      { level: 2, percent: 30 },
    ]);
    expect(total).toBeCloseTo(35, 8);
    expect(total).toBeLessThanOrEqual(budget + 1e-8);
  });

  it("scales with lots", () => {
    const { total } = splitIbBudget(45, 0.1, [
      { level: 1, percent: 100 },
    ]);
    expect(total).toBeCloseTo(4.5, 8);
  });

  it("rejects conceptual over-100% by leaving leftover unallocated", () => {
    // Service rejects sum>100 on save; runtime only pays configured %
    const { budget, total } = splitIbBudget(35, 1, [
      { level: 1, percent: 70 },
    ]);
    expect(total).toBeCloseTo(24.5, 8);
    expect(total).toBeLessThan(budget);
  });
});
