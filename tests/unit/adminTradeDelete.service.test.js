import { beforeEach, describe, expect, it, vi } from "vitest";

const accountId = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";
const tradeId = "507f1f77bcf86cd799439013";

const tradeSave = vi.fn(async function save() {
  return this;
});
const accountSave = vi.fn(async function save() {
  return this;
});

const closedTrade = {
  _id: tradeId,
  accountId,
  userId,
  status: "CLOSED",
  positionId: "pos-1",
  realizedPnL: 40,
  isDeleted: false,
  deleteBalanceDelta: 0,
  save: tradeSave,
};

const accountDoc = {
  _id: accountId,
  user_id: userId,
  balance: 1000,
  leverage: 100,
  save: accountSave,
};

vi.mock("../../src/models/Trade.model.js", () => ({
  default: {
    findOne: vi.fn(async () => closedTrade),
    find: vi.fn(() => ({
      sort: () => ({
        lean: async () => [],
      }),
    })),
  },
}));

vi.mock("../../src/models/PendingOrder.model.js", () => ({
  default: {
    findOne: vi.fn(async () => null),
    find: vi.fn(() => ({
      sort: () => ({
        lean: async () => [],
      }),
    })),
  },
}));

vi.mock("../../src/models/Account.model.js", () => ({
  default: {
    findOne: vi.fn(async () => accountDoc),
    find: vi.fn(() => ({
      select: () => ({
        lean: async () => [],
      }),
    })),
  },
}));

vi.mock("../../src/trade-engine/bootstrap.js", () => ({
  tradeEngine: {
    accounts: new Map(),
    loadAccount: vi.fn(),
    loadOpenPosition: vi.fn(),
    loadPendingOrder: vi.fn(),
    recalcUsedMargin: vi.fn(),
  },
}));

vi.mock("../../src/services/activity.service.js", () => ({
  ACTIVITY_ACTIONS: {
    TRADE_DELETED_BY_ADMIN: "TRADE_DELETED_BY_ADMIN",
    TRADE_RESTORED_BY_ADMIN: "TRADE_RESTORED_BY_ADMIN",
  },
  ACTOR_TYPES: { ADMIN: "ADMIN" },
  recordActivity: vi.fn(async () => undefined),
}));

const { adminDeleteTradeService, adminRestoreTradeService } = await import(
  "../../src/services/adminTradeDelete.service.js"
);
const Trade = (await import("../../src/models/Trade.model.js")).default;
const { recordActivity } = await import("../../src/services/activity.service.js");

describe("adminDeleteTradeService / adminRestoreTradeService", () => {
  beforeEach(() => {
    closedTrade.isDeleted = false;
    closedTrade.realizedPnL = 40;
    closedTrade.deleteBalanceDelta = 0;
    closedTrade.status = "CLOSED";
    accountDoc.balance = 1000;
    tradeSave.mockClear();
    accountSave.mockClear();
    recordActivity.mockClear();
    Trade.findOne.mockImplementation(async () => closedTrade);
  });

  it("deletes closed trade without changing balance", async () => {
    const result = await adminDeleteTradeService(
      {
        kind: "CLOSED",
        accountId,
        userId,
        tradeId,
      },
      { actorId: "admin-1" }
    );

    expect(closedTrade.isDeleted).toBe(true);
    expect(closedTrade.deleteBalanceDelta).toBe(0);
    expect(accountDoc.balance).toBe(1000);
    expect(accountSave).not.toHaveBeenCalled();
    expect(result.balanceDelta).toBe(0);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TRADE_DELETED_BY_ADMIN" })
    );
  });

  it("restores closed trade without changing balance", async () => {
    closedTrade.isDeleted = true;
    closedTrade.deleteBalanceDelta = 0;
    accountDoc.balance = 1000;

    const result = await adminRestoreTradeService(
      {
        kind: "CLOSED",
        accountId,
        userId,
        tradeId,
      },
      { actorId: "admin-1" }
    );

    expect(closedTrade.isDeleted).toBe(false);
    expect(accountDoc.balance).toBe(1000);
    expect(accountSave).not.toHaveBeenCalled();
    expect(result.balanceDelta).toBe(0);
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: "TRADE_RESTORED_BY_ADMIN" })
    );
  });
});
