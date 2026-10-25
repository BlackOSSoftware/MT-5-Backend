import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const summaryMock = vi.fn(async () => ({
  totalProfiles: 4,
  linkedUsers: 3,
  totalReferrers: 2,
  levelCounts: { 1: 2, 2: 1 },
  unlinkedUsers: 1,
}));

const networkMock = vi.fn(async () => ({
  items: [
    {
      userId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      user: { _id: "aaaaaaaaaaaaaaaaaaaaaaaa", name: "Alice" },
      directReferrals: 2,
      networkSize: 3,
      levelBreakdown: { 1: 2, 2: 1 },
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
}));

const linksMock = vi.fn(async () => ({
  items: [
    {
      referrerUserId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      referredUserId: "bbbbbbbbbbbbbbbbbbbbbbbb",
      referrer: { name: "Alice" },
      referred: { name: "Bob" },
    },
  ],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
}));

const treeMock = vi.fn(async () => ({
  root: { user: { name: "Alice" }, referralCode: "ROOT1" },
  stats: { directReferrals: 2, networkSize: 3, levelBreakdown: { 1: 2, 2: 1 } },
  tree: { userId: "aaaaaaaaaaaaaaaaaaaaaaaa", level: 0, children: [] },
}));

vi.mock("../../src/middlewares/auth.middleware.js", () => ({
  authMiddleware: (req, res, next) => {
    const role = String(req.headers["x-test-role"] || "ADMIN").toUpperCase();
    if (role === "NONE") {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    req.user = {
      _id: "507f1f77bcf86cd799439099",
      userType: role === "USER" ? "USER" : "ADMIN",
    };
    return next();
  },
}));

vi.mock("../../src/services/referralReport.service.js", () => ({
  adminReferralNetworkSummaryService: (...args) => summaryMock(...args),
  adminListReferralNetworkService: (...args) => networkMock(...args),
  adminListReferralLinksService: (...args) => linksMock(...args),
  adminGetReferralTreeService: (...args) => treeMock(...args),
}));

const userSummaryMock = vi.fn(async () => ({
  referralCode: "SNEHA1",
  totalReferrals: 2,
  referralBalance: 25,
  totalEarned: 50,
  pendingCount: 1,
  pendingAmount: 25,
  status: "CONFIRMED",
  referredBy: null,
}));

vi.mock("../../src/services/referral.service.js", () => ({
  getReferralSummaryService: vi.fn(),
  getAdminUserReferralSummaryService: (...args) => userSummaryMock(...args),
  listReferralRewardsService: vi.fn(),
  requestReferralRewardService: vi.fn(),
  adminListReferralRewardsService: vi.fn(),
  adminApproveReferralRewardService: vi.fn(),
  adminRejectReferralRewardService: vi.fn(),
}));

const {
  adminReferralNetworkSummary,
  adminListReferralNetwork,
  adminListReferralLinks,
  adminGetReferralTree,
  adminGetUserReferralSummary,
} = await import("../../src/controllers/referral.controller.js");
const { adminAuth } = await import(
  "../../src/middlewares/adminAuth.middleware.js"
);
const { authMiddleware } = await import(
  "../../src/middlewares/auth.middleware.js"
);

function createApp() {
  const app = express();
  app.use(express.json());
  const router = express.Router();
  router.get(
    "/admin/users/:userId/summary",
    authMiddleware,
    adminAuth,
    adminGetUserReferralSummary,
  );
  router.get(
    "/admin/network/summary",
    authMiddleware,
    adminAuth,
    adminReferralNetworkSummary,
  );
  router.get(
    "/admin/network/links",
    authMiddleware,
    adminAuth,
    adminListReferralLinks,
  );
  router.get(
    "/admin/network/:userId/tree",
    authMiddleware,
    adminAuth,
    adminGetReferralTree,
  );
  router.get(
    "/admin/network",
    authMiddleware,
    adminAuth,
    adminListReferralNetwork,
  );
  app.use("/v1/referrals", router);
  return app;
}

describe("admin referral report routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET summary returns network overview for admin", async () => {
    const res = await request(createApp())
      .get("/v1/referrals/admin/network/summary")
      .set("x-test-role", "ADMIN");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalReferrers).toBe(2);
    expect(summaryMock).toHaveBeenCalled();
  });

  it("GET user summary returns referral count and earned bonus", async () => {
    const res = await request(createApp())
      .get("/v1/referrals/admin/users/aaaaaaaaaaaaaaaaaaaaaaaa/summary")
      .set("x-test-role", "ADMIN");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalReferrals).toBe(2);
    expect(res.body.data.totalEarned).toBe(50);
    expect(userSummaryMock).toHaveBeenCalledWith("aaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("GET network lists referrers", async () => {
    const res = await request(createApp())
      .get("/v1/referrals/admin/network?page=1&limit=20")
      .set("x-test-role", "ADMIN");
    expect(res.status).toBe(200);
    expect(res.body.items[0].directReferrals).toBe(2);
    expect(networkMock).toHaveBeenCalled();
  });

  it("GET links returns who-referred-whom", async () => {
    const res = await request(createApp())
      .get("/v1/referrals/admin/network/links")
      .set("x-test-role", "ADMIN");
    expect(res.status).toBe(200);
    expect(res.body.items[0].referrer.name).toBe("Alice");
    expect(linksMock).toHaveBeenCalled();
  });

  it("GET tree returns hierarchy for a user", async () => {
    const res = await request(createApp())
      .get("/v1/referrals/admin/network/aaaaaaaaaaaaaaaaaaaaaaaa/tree")
      .set("x-test-role", "ADMIN");
    expect(res.status).toBe(200);
    expect(res.body.data.root.user.name).toBe("Alice");
    expect(treeMock).toHaveBeenCalledWith(
      "aaaaaaaaaaaaaaaaaaaaaaaa",
      expect.any(Object),
    );
  });

  it("blocks non-admin from network summary", async () => {
    const res = await request(createApp())
      .get("/v1/referrals/admin/network/summary")
      .set("x-test-role", "USER");
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
