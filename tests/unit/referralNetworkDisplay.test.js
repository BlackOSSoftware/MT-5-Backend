/**
 * Mirrors admin/utils/referralNetworkDisplay.ts for UI copy contracts.
 * Kept here so CI runs without a separate admin vitest setup.
 */
import { describe, expect, it } from "vitest";

function formatLevelBreakdown(breakdown) {
  if (!breakdown) return "No downline";
  const parts = Object.entries(breakdown)
    .map(([k, v]) => [Number(k), Number(v)])
    .filter(([level, count]) => level > 0 && count > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([level, count]) => `L${level}:${count}`);
  return parts.length ? parts.join(" · ") : "No downline";
}

function describeReferralExample(direct, network) {
  const d = Math.max(0, Number(direct) || 0);
  const n = Math.max(0, Number(network) || 0);
  if (d === 0) return "No direct referrals yet.";
  const nested = Math.max(n - d, 0);
  if (nested === 0) {
    return `Referred ${d} person${d === 1 ? "" : "s"} directly.`;
  }
  return `Referred ${d} directly; network total ${n} (includes ${nested} deeper).`;
}

describe("referral network UI copy", () => {
  it("formats level chips text", () => {
    expect(formatLevelBreakdown({ 1: 2, 2: 3 })).toBe("L1:2 · L2:3");
    expect(formatLevelBreakdown({})).toBe("No downline");
  });

  it("describes 1st person → 2 direct, deeper network", () => {
    expect(describeReferralExample(2, 5)).toBe(
      "Referred 2 directly; network total 5 (includes 3 deeper).",
    );
    expect(describeReferralExample(2, 2)).toBe("Referred 2 persons directly.");
    expect(describeReferralExample(1, 1)).toBe("Referred 1 person directly.");
  });
});
