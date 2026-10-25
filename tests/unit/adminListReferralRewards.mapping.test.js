import { beforeEach, describe, expect, it, vi } from "vitest";

const findMock = vi.fn();
const countMock = vi.fn();

vi.mock("../../src/models/ReferralReward.model.js", () => ({
  default: {
    find: (...args) => findMock(...args),
    countDocuments: (...args) => countMock(...args),
  },
}));

vi.mock("../../src/models/Referral.model.js", () => ({
  default: {
    findOneAndUpdate: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock("../../src/models/Account.model.js", () => ({ default: {} }));
vi.mock("../../src/models/AccountPlan.model.js", () => ({ default: {} }));
vi.mock("../../src/models/Transaction.model.js", () => ({ default: {} }));
vi.mock("../../src/utils/referralCode.util.js", () => ({
  generateReferralCode: () => "CODE01",
}));
vi.mock("../../src/trade-engine/EngineSync.js", () => ({ default: {} }));
vi.mock("../../src/trade-engine/EngineSyncBus.js", () => ({
  publishAccountBalance: vi.fn(),
}));

const { adminListReferralRewardsService } = await import(
  "../../src/services/referral.service.js"
);

function leanChain(docs) {
  return {
    populate: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(docs),
  };
}

describe("adminListReferralRewardsService mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("populates users and exposes camelCase fields for admin UI", async () => {
    findMock.mockReturnValue(
      leanChain([
        {
          _id: "reward1",
          status: "APPROVED",
          reward_amount: 25,
          referrer_user: {
            _id: "aaaaaaaaaaaaaaaaaaaaaaaa",
            name: "Sneha Nair",
            email: "sneha.nair.fx@gmail.com",
            phone: "+919811100006",
          },
          referred_user: {
            _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
            name: "Arjun Mehta",
            email: "arjun.mehta.fx@gmail.com",
          },
          requested_at: null,
          approved_at: new Date("2026-10-25T10:22:00.000Z"),
          rejected_at: null,
          rejection_reason: "",
          createdAt: new Date("2026-10-25T10:20:00.000Z"),
          updatedAt: new Date("2026-10-25T10:22:00.000Z"),
        },
      ]),
    );
    countMock.mockResolvedValue(1);

    const result = await adminListReferralRewardsService({ page: 1, limit: 20 });

    expect(result.items).toHaveLength(1);
    const row = result.items[0];
    expect(row.amount).toBe(25);
    expect(row.rewardAmount).toBe(25);
    expect(row.referrerUser.name).toBe("Sneha Nair");
    expect(row.referredUser.email).toBe("arjun.mehta.fx@gmail.com");
    expect(row.approvedAt).toEqual(new Date("2026-10-25T10:22:00.000Z"));
    expect(result.pagination.total).toBe(1);
  });
});
