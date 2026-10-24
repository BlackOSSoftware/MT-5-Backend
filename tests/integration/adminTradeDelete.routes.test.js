import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const accountId = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";
const tradeId = "507f1f77bcf86cd799439013";

const deleteMock = vi.fn(async () => ({
  kind: "CLOSED",
  balanceDelta: -40,
  balance: 960,
}));
const restoreMock = vi.fn(async () => ({
  kind: "CLOSED",
  balanceDelta: 40,
  balance: 1000,
}));
const listMock = vi.fn(async () => ({
  items: [{ _id: tradeId, kind: "CLOSED", isDeleted: true }],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
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

vi.mock("../../src/services/adminTradeDelete.service.js", () => ({
  adminDeleteTradeService: (...args) => deleteMock(...args),
  adminRestoreTradeService: (...args) => restoreMock(...args),
  adminListDeletedTradesService: (...args) => listMock(...args),
}));

vi.mock("../../src/trade-engine/bootstrap.js", () => ({
  tradeEngine: { accounts: new Map() },
}));

vi.mock("../../src/trade-engine/EngineSyncBus.js", () => ({
  publishAccountBalance: vi.fn(),
}));

vi.mock("../../src/services/orderTicket.service.js", () => ({
  nextOrderTicket: vi.fn(async () => 1),
  nextDealTicket: vi.fn(async () => 1),
}));

vi.mock("../../src/models/Account.model.js", () => ({
  default: { findOne: vi.fn() },
}));

vi.mock("../../src/services/adminClosedTradeEdit.service.js", () => ({
  adminEditClosedTradeService: vi.fn(),
}));

const {
  adminDeleteTrade,
  adminRestoreTrade,
  adminListDeletedTrades,
} = await import("../../src/controllers/tradeAdmin.controller.js");
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
  router.post("/trade/delete", authMiddleware, adminAuth, adminDeleteTrade);
  router.post("/trade/restore", authMiddleware, adminAuth, adminRestoreTrade);
  router.get("/trades/deleted", authMiddleware, adminAuth, adminListDeletedTrades);
  app.use("/api/v1/trade-admin", router);
  return app;
}

describe("admin trade delete/restore endpoints", () => {
  beforeEach(() => {
    deleteMock.mockClear();
    restoreMock.mockClear();
    listMock.mockClear();
  });

  it("POST /trade/delete → 200", async () => {
    const res = await request(createApp())
      .post("/api/v1/trade-admin/trade/delete")
      .set("x-test-role", "ADMIN")
      .send({ kind: "CLOSED", accountId, userId, tradeId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(deleteMock).toHaveBeenCalled();
  });

  it("POST /trade/restore → 200", async () => {
    const res = await request(createApp())
      .post("/api/v1/trade-admin/trade/restore")
      .set("x-test-role", "ADMIN")
      .send({ kind: "CLOSED", accountId, userId, tradeId });

    expect(res.status).toBe(200);
    expect(restoreMock).toHaveBeenCalled();
  });

  it("GET /trades/deleted → 200", async () => {
    const res = await request(createApp())
      .get("/api/v1/trade-admin/trades/deleted")
      .set("x-test-role", "ADMIN");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("non-admin → 403", async () => {
    const res = await request(createApp())
      .post("/api/v1/trade-admin/trade/delete")
      .set("x-test-role", "USER")
      .send({ kind: "CLOSED", accountId, userId, tradeId });

    expect(res.status).toBe(403);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
