import { describe, expect, it } from "vitest";
import {
  buildChildrenMap,
  buildReferralLinks,
  buildReferralTree,
  computeGlobalLevelCounts,
  summarizeDownline,
} from "../../src/services/referralReport.helpers.js";

/**
 * Network:
 *   A
 *   ├─ B
 *   │  ├─ D
 *   │  └─ E
 *   └─ C
 *      └─ F
 */
const rows = [
  { userId: "A", referredBy: null },
  { userId: "B", referredBy: "A" },
  { userId: "C", referredBy: "A" },
  { userId: "D", referredBy: "B" },
  { userId: "E", referredBy: "B" },
  { userId: "F", referredBy: "C" },
];

describe("referralReport.helpers", () => {
  it("builds children map for each referrer", () => {
    const map = buildChildrenMap(rows);
    expect(map.get("A").sort()).toEqual(["B", "C"]);
    expect(map.get("B").sort()).toEqual(["D", "E"]);
    expect(map.get("C")).toEqual(["F"]);
    expect(map.has("D")).toBe(false);
  });

  it("summarizes downline: A has 2 direct and 5 network", () => {
    const map = buildChildrenMap(rows);
    const stats = summarizeDownline("A", map);
    expect(stats.directReferrals).toBe(2);
    expect(stats.networkSize).toBe(5);
    expect(stats.levelBreakdown).toEqual({ 1: 2, 2: 3 });
    expect(stats.maxDepth).toBe(2);
  });

  it("summarizes downline for mid-level referrer B", () => {
    const map = buildChildrenMap(rows);
    const stats = summarizeDownline("B", map);
    expect(stats.directReferrals).toBe(2);
    expect(stats.networkSize).toBe(2);
    expect(stats.levelBreakdown).toEqual({ 1: 2 });
  });

  it("builds nested tree with correct levels", () => {
    const map = buildChildrenMap(rows);
    const users = new Map([
      ["A", { _id: "A", name: "Alice" }],
      ["B", { _id: "B", name: "Bob" }],
      ["C", { _id: "C", name: "Cara" }],
      ["D", { _id: "D", name: "Dan" }],
      ["E", { _id: "E", name: "Eve" }],
      ["F", { _id: "F", name: "Fay" }],
    ]);
    const tree = buildReferralTree("A", map, users, 8);
    expect(tree.level).toBe(0);
    expect(tree.user.name).toBe("Alice");
    expect(tree.children).toHaveLength(2);
    const bob = tree.children.find((c) => c.userId === "B");
    expect(bob.level).toBe(1);
    expect(bob.children.map((c) => c.userId).sort()).toEqual(["D", "E"]);
    expect(bob.children[0].level).toBe(2);
  });

  it("respects maxDepth when building tree", () => {
    const map = buildChildrenMap(rows);
    const tree = buildReferralTree("A", map, new Map(), 1);
    expect(tree.children).toHaveLength(2);
    expect(tree.children.every((c) => c.children.length === 0)).toBe(true);
  });

  it("builds flat who-referred-whom links", () => {
    const users = new Map([
      ["A", { _id: "A", name: "Alice" }],
      ["B", { _id: "B", name: "Bob" }],
    ]);
    const links = buildReferralLinks(
      [
        { userId: "B", referredBy: "A", referralCode: "BOB1", status: "PENDING" },
        { userId: "A", referredBy: null },
      ],
      users,
    );
    expect(links).toHaveLength(1);
    expect(links[0].referrer.name).toBe("Alice");
    expect(links[0].referred.name).toBe("Bob");
    expect(links[0].referralCode).toBe("BOB1");
  });

  it("computes global level counts", () => {
    const global = computeGlobalLevelCounts(rows);
    expect(global.linkedUsers).toBe(5);
    expect(global.totalReferrers).toBe(3); // A, B, C
    expect(global.levelCounts[1]).toBe(2); // B, C under A
    expect(global.levelCounts[2]).toBe(3); // D, E, F
  });
});
