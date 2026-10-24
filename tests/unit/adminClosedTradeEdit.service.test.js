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

const tradeDoc = {
  _id: tradeId,
  accountId,
  userId,
  status: "CLOSED",
  side: "BUY",
  volume: 1,
  openPrice: 10,
  closePrice: 11,
  contractSize: 1,
  stopLoss: 9,
  takeProfit: 12,
  commission: 0,
  spread: 0,
  swap: 0,
  grossPnL: 10,
  realizedPnL: 10,
  closeReason: "MANUAL",
  save: tradeSave,
};

const accountDoc = {
  _id: accountId,
  user_id: userId,
  balance: 1000,
  save: accountSave,
};

vi.mock("../../src/models/Trade.model.js", () => ({
  default: {
    findOne: vi.fn(async () => tradeDoc),
  },
}));

vi.mock("../../src/models/Account.model.js", () => ({
  default: {
    findOne: vi.fn(async () => accountDoc),
  },
}));

vi.mock("../../src/services/activity.service.js", () => ({
  ACTIVITY_ACTIONS: { TRADE_CLOSED_EDITED_BY_ADMIN: "TRADE_CLOSED_EDITED_BY_ADMIN" },
  ACTOR_TYPES: { ADMIN: "ADMIN" },
  recordActivity: vi.fn(async () => undefined),
}));

const { adminEditClosedTradeService } = await import(
  "../../src/services/adminClosedTradeEdit.service.js"
);
const Trade = (await import("../../src/models/Trade.model.js")).default;
const Account = (await import("../../src/models/Account.model.js")).default;
const { recordActivity } = await import("../../src/services/activity.service.js");

describe("adminEditClosedTradeService", () => {
  beforeEach(() => {
    tradeDoc.realizedPnL = 10;
    tradeDoc.grossPnL = 10;
    tradeDoc.volume = 1;
    tradeDoc.openPrice = 10;
    tradeDoc.closePrice = 11;
    tradeDoc.side = "BUY";
    tradeDoc.contractSize = 1;
    accountDoc.balance = 1000;
    tradeSave.mockClear();
    accountSave.mockClear();
    recordActivity.mockClear();
    Trade.findOne.mockClear();
    Account.findOne.mockClear();
  });

  it("applies balance delta = newPnL - oldPnL", async () => {
    const result = await adminEditClosedTradeService(
      {
        accountId,
        userId,
        tradeId,
        realizedPnL: 55,
      },
      { actorId: "admin-1" }
    );

    expect(tradeDoc.realizedPnL).toBe(55);
    expect(accountDoc.balance).toBe(1045);
    expect(result.balanceDelta).toBe(45);
    expect(tradeSave).toHaveBeenCalled();
    expect(accountSave).toHaveBeenCalled();
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "TRADE_CLOSED_EDITED_BY_ADMIN",
        actorType: "ADMIN",
      })
    );
  });

  it("recalculates PnL + balance when close price changes", async () => {
    // BUY: (12 - 10) * 1 * 1 = 2; old PnL 10 → delta -8
    const result = await adminEditClosedTradeService(
      {
        accountId,
        userId,
        tradeId,
        closePrice: 12,
        realizedPnL: 10, // stale form value — ignored when prices change
      },
      { actorId: "admin-1" }
    );

    expect(tradeDoc.closePrice).toBe(12);
    expect(tradeDoc.realizedPnL).toBe(2);
    expect(tradeDoc.grossPnL).toBe(2);
    expect(result.balanceDelta).toBe(-8);
    expect(accountDoc.balance).toBe(992);
    expect(accountSave).toHaveBeenCalled();
  });

  it("recalculates PnL when volume changes", async () => {
    // BUY: (11 - 10) * 2 * 1 = 2; old 10 → delta -8
    await adminEditClosedTradeService(
      {
        accountId,
        userId,
        tradeId,
        volume: 2,
      },
      { actorId: "admin-1" }
    );

    expect(tradeDoc.volume).toBe(2);
    expect(tradeDoc.realizedPnL).toBe(2);
    expect(accountSave).toHaveBeenCalled();
  });
});
