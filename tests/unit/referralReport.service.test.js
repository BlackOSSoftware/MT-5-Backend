import { beforeEach, describe, expect, it, vi } from "vitest";

const referralFind = vi.fn();
const userFind = vi.fn();

vi.mock("../../src/models/Referral.model.js", () => ({
  default: {
    find: (...args) => referralFind(...args),
  },
}));

vi.mock("../../src/models/User.model.js", () => ({
  default: {
    find: (...args) => userFind(...args),
  },
}));

const {
  adminGetReferralTreeService,
  adminListReferralNetworkService,
  adminReferralNetworkSummaryService,
} = await import("../../src/services/referralReport.service.js");

function leanChain(data) {
  return {
    select: () => ({
      lean: async () => data,
    }),
  };
}

describe("referralReport.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const docs = [
    {
      user_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      referred_by: null,
      referral_code: "ROOT1",
      status: "CONFIRMED",
      total_earned: 100,
      referral_balance: 40,
      createdAt: new Date("2026-01-01"),
    },
    {
      user_id: "bbbbbbbbbbbbbbbbbbbbbbbb",
      referred_by: "aaaaaaaaaaaaaaaaaaaaaaaa",
      referral_code: "BOB001",
      status: "PENDING",
      total_earned: 0,
      referral_balance: 0,
      createdAt: new Date("2026-01-02"),
    },
    {
      user_id: "cccccccccccccccccccccccc",
      referred_by: "aaaaaaaaaaaaaaaaaaaaaaaa",
      referral_code: "CARA01",
      status: "PENDING",
      total_earned: 0,
      referral_balance: 0,
      createdAt: new Date("2026-01-03"),
    },
    {
      user_id: "dddddddddddddddddddddddd",
      referred_by: "bbbbbbbbbbbbbbbbbbbbbbbb",
      referral_code: "DAN001",
      status: "PENDING",
      total_earned: 0,
      referral_balance: 0,
      createdAt: new Date("2026-01-04"),
    },
  ];

  const users = [
    { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Alice", email: "a@x.com", phone: "1" },
    { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", name: "Bob", email: "b@x.com", phone: "2" },
    { _id: "cccccccccccccccccccccccc", name: "Cara", email: "c@x.com", phone: "3" },
    { _id: "dddddddddddddddddddddddd", name: "Dan", email: "d@x.com", phone: "4" },
  ];

  it("summary counts linked users and referrers", async () => {
    referralFind.mockReturnValue(leanChain(docs));
    const summary = await adminReferralNetworkSummaryService();
    expect(summary.totalProfiles).toBe(4);
    expect(summary.linkedUsers).toBe(3);
    expect(summary.totalReferrers).toBe(2);
    expect(summary.levelCounts[1]).toBe(2);
    expect(summary.levelCounts[2]).toBe(1);
  });

  it("lists network with Alice having 2 direct and 3 network", async () => {
    referralFind.mockReturnValue(leanChain(docs));
    userFind.mockReturnValue(leanChain(users));
    const result = await adminListReferralNetworkService({ page: 1, limit: 10 });
    expect(result.items.length).toBeGreaterThanOrEqual(1);
    const alice = result.items.find(
      (i) => i.userId === "aaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(alice.directReferrals).toBe(2);
    expect(alice.networkSize).toBe(3);
    expect(alice.levelBreakdown).toEqual({ 1: 2, 2: 1 });
    expect(alice.user.name).toBe("Alice");
  });

  it("returns tree for Alice with nested children", async () => {
    referralFind.mockReturnValue(leanChain(docs));
    userFind.mockReturnValue(leanChain(users));
    const result = await adminGetReferralTreeService(
      "aaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(result.root.user.name).toBe("Alice");
    expect(result.stats.directReferrals).toBe(2);
    expect(result.stats.networkSize).toBe(3);
    expect(result.tree.children).toHaveLength(2);
    const bob = result.tree.children.find(
      (c) => c.userId === "bbbbbbbbbbbbbbbbbbbbbbbb",
    );
    expect(bob.children).toHaveLength(1);
    expect(bob.children[0].user.name).toBe("Dan");
  });

  it("rejects invalid userId for tree", async () => {
    await expect(adminGetReferralTreeService("bad-id")).rejects.toThrow(
      /Invalid userId/i,
    );
  });
});
