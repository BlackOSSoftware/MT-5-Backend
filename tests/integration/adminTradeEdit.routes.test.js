import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const accountId = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";
const positionId = "pos-live-1";
const orderId = "pending-1";
const tradeId = "507f1f77bcf86cd799439013";

const modifyPositionMock = vi.fn((args) => ({
  positionId: args.positionId,
  volume: args.volume ?? 0.01,
  openPrice: args.openPrice ?? 100,
  stopLoss: args.stopLoss ?? null,
  takeProfit: args.takeProfit ?? null,
}));

const modifyPendingMock = vi.fn((args) => ({
  orderId: args.orderId,
  volume: args.volume ?? 1,
  price: args.price ?? 1.1,
  stopLoss: args.stopLoss ?? null,
  takeProfit: args.takeProfit ?? null,
}));

const closedEditMock = vi.fn(async (body) => ({
  trade: {
    _id: tradeId,
    status: "CLOSED",
    realizedPnL: body.realizedPnL ?? 50,
    volume: body.volume ?? 1,
  },
  balanceDelta: 40,
  balance: 1040,
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

vi.mock("../../src/trade-engine/bootstrap.js", () => {
  const accounts = new Map();
  const symbols = new Map([["XAUUSD", { bid: 2000, ask: 2001, contractSize: 100 }]]);
  return {
    tradeEngine: {
      accounts,
      symbols,
      loadAccount: vi.fn(({ accountId: id, ...rest }) => {
        const existing = accounts.get(String(id));
        if (existing) return existing;
        const acc = {
          accountId: String(id),
          ...rest,
          positions: new Map([
            [
              positionId,
              {
                positionId,
                ticket: 1001,
                symbol: "XAUUSD",
                side: "BUY",
                volume: 0.01,
                openPrice: 100,
                stopLoss: null,
                takeProfit: null,
              },
            ],
          ]),
          pendingOrders: new Map([
            [
              orderId,
              {
                orderId,
                ticket: 2001,
                symbol: "XAUUSD",
                side: "BUY",
                orderType: "BUY_LIMIT",
                price: 1.1,
                volume: 1,
                stopLoss: null,
                takeProfit: null,
              },
            ],
          ]),
        };
        accounts.set(String(id), acc);
        return acc;
      }),
      loadOpenPosition: vi.fn(),
      loadPendingOrder: vi.fn(),
      loadSymbol: vi.fn(),
      modifyPosition: (...args) => modifyPositionMock(...args),
      modifyPendingOrder: (...args) => modifyPendingMock(...args),
    },
  };
});

vi.mock("../../src/models/Account.model.js", () => ({
  default: {
    findOne: vi.fn(() => ({
      select: vi.fn(() => ({
        lean: vi.fn(async () => ({
          _id: accountId,
          user_id: userId,
          balance: 1000,
          bonus_balance: 0,
          equity: 1000,
          leverage: 100,
          commission_per_lot: 0,
          swap_charge: 0,
          spread_enabled: false,
        })),
      })),
    })),
  },
}));

vi.mock("../../src/models/Trade.model.js", () => ({
  default: {
    findOne: vi.fn(() => ({
      lean: vi.fn(async () => null),
    })),
    updateOne: vi.fn(async () => ({ acknowledged: true, modifiedCount: 1 })),
  },
}));

vi.mock("../../src/models/PendingOrder.model.js", () => ({
  default: {
    findOne: vi.fn(() => ({
      lean: vi.fn(async () => null),
    })),
  },
}));

vi.mock("../../src/models/Instrument.model.js", () => ({
  default: {
    findOne: vi.fn(() => ({
      lean: vi.fn(async () => null),
    })),
  },
}));

vi.mock("../../src/services/adminClosedTradeEdit.service.js", () => ({
  adminEditClosedTradeService: (...args) => closedEditMock(...args),
}));

vi.mock("../../src/trade-engine/EngineSyncBus.js", () => ({
  publishAccountBalance: vi.fn(),
}));

vi.mock("../../src/services/orderTicket.service.js", () => ({
  nextOrderTicket: vi.fn(async () => 1001),
  nextDealTicket: vi.fn(async () => 2001),
}));

const {
  adminModifyPosition,
  adminModifyPendingOrder,
  adminModifyClosedTrade,
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
  router.patch(
    "/trade/position/modify",
    authMiddleware,
    adminAuth,
    adminModifyPosition
  );
  router.patch(
    "/trade/pending/modify",
    authMiddleware,
    adminAuth,
    adminModifyPendingOrder
  );
  router.patch(
    "/trade/closed/modify",
    authMiddleware,
    adminAuth,
    adminModifyClosedTrade
  );
  app.use("/api/v1/trade-admin", router);
  return app;
}

describe("admin trade edit endpoints", () => {
  beforeEach(() => {
    modifyPositionMock.mockClear();
    modifyPendingMock.mockClear();
    closedEditMock.mockClear();
  });

  it("PATCH position/modify with volume+openPrice → 200 and engine updated", async () => {
    const app = createApp();
    const res = await request(app)
      .patch("/api/v1/trade-admin/trade/position/modify")
      .set("x-test-role", "ADMIN")
      .send({
        accountId,
        userId,
        positionId,
        volume: 0.05,
        openPrice: 123.45,
        stopLoss: 120,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(modifyPositionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        positionId,
        volume: 0.05,
        openPrice: 123.45,
        stopLoss: 120,
      })
    );
  });

  it("PATCH pending/modify with volume+price → 200", async () => {
    const app = createApp();
    const res = await request(app)
      .patch("/api/v1/trade-admin/trade/pending/modify")
      .set("x-test-role", "ADMIN")
      .send({
        accountId,
        userId,
        orderId,
        volume: 2,
        price: 1.2345,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(modifyPendingMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        orderId,
        volume: 2,
        price: 1.2345,
      })
    );
  });

  it("PATCH closed/modify → service called + 200", async () => {
    const app = createApp();
    const res = await request(app)
      .patch("/api/v1/trade-admin/trade/closed/modify")
      .set("x-test-role", "ADMIN")
      .send({
        accountId,
        userId,
        tradeId,
        realizedPnL: 50,
        volume: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(closedEditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId,
        userId,
        tradeId,
        realizedPnL: 50,
      }),
      expect.objectContaining({ actorId: expect.any(String) })
    );
    expect(res.body.data.balanceDelta).toBe(40);
  });

  it("non-admin → 403", async () => {
    const app = createApp();
    const res = await request(app)
      .patch("/api/v1/trade-admin/trade/position/modify")
      .set("x-test-role", "USER")
      .send({
        accountId,
        userId,
        positionId,
        volume: 0.02,
      });

    expect(res.status).toBe(403);
    expect(modifyPositionMock).not.toHaveBeenCalled();
  });
});
