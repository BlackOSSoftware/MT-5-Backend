import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import Account from "../models/Account.model.js";
import { nextOrderTicket } from "../services/orderTicket.service.js";
import Instrument from "../models/Instrument.model.js";
import Trade from "../models/Trade.model.js";
import PendingOrder from "../models/PendingOrder.model.js";
import Transaction from "../models/Transaction.model.js";
import { tradeEngine } from "../trade-engine/bootstrap.js";
import { publishAccountBalance } from "../trade-engine/EngineSyncBus.js";
import {
  adminListBrokerageService,
  adminListClosedTradesService,
  adminListOpenTradesService,
  adminListPendingOrdersHistoryService,
  adminListPendingOrdersOpenService,
  adminListUsersFundsService,
  getTradeAdminSummaryService,
} from "../services/tradeAdmin.service.js";
import {
  normalizeLivePositionEdit,
  normalizePendingOrderEdit,
  resolveOptionalField,
} from "../services/adminTradeEdit.validation.js";
import { adminEditClosedTradeService } from "../services/adminClosedTradeEdit.service.js";
import {
  adminDeleteTradeService,
  adminListDeletedTradesService,
  adminRestoreTradeService,
} from "../services/adminTradeDelete.service.js";

function normalizeSymbol(symbol) {
  return String(symbol || "").trim().toUpperCase();
}

function toFiniteNumber(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${fieldName} must be a number`);
  }
  return n;
}

function toOptionalFiniteNumber(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  return toFiniteNumber(value, fieldName);
}

function toMaybeFiniteNumber(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (value === "") return null;
  return toFiniteNumber(value, fieldName);
}

function getRequestIp(req) {
  const forwarded = req?.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return req?.ip || req?.connection?.remoteAddress || "SYSTEM";
}

function toDate(value, fieldName) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid datetime`);
  }
  return date;
}

function generateHistoryPositionId(index = 0) {
  return randomUUID();
}

async function getAccountForAdminTrade({ userId, accountId }) {
  if (!userId || !mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid userId");
  }

  if (!accountId || !mongoose.isValidObjectId(accountId)) {
    throw new Error("Invalid accountId");
  }

  const account = await Account.findOne({
    _id: new mongoose.Types.ObjectId(accountId),
    user_id: new mongoose.Types.ObjectId(userId),
    status: "active",
  })
    .select({
      _id: 1,
      user_id: 1,
      balance: 1,
      bonus_balance: 1,
      equity: 1,
      leverage: 1,
      commission_per_lot: 1,
      swap_charge: 1,
      spread_enabled: 1,
    })
    .lean();

  if (!account) {
    throw new Error("Account not found for this user");
  }

  return account;
}

function ensureEngineAccountLoaded(accountDoc, ipAddress = "SYSTEM") {
  const accountId = String(accountDoc._id);
  const userId = String(accountDoc.user_id);

  let engineAccount = tradeEngine.accounts.get(accountId);

  // Load account into engine if missing (do NOT overwrite existing state)
  if (!engineAccount) {
    tradeEngine.loadAccount({
      accountId,
      balance: accountDoc.balance,
      leverage: accountDoc.leverage,
      userId,
      lastIp: ipAddress,
      commission_per_lot: Number(accountDoc.commission_per_lot) || 0,
      swap_charge: Number(accountDoc.swap_charge) || 0,
      spread_enabled: Boolean(accountDoc.spread_enabled),
    });

    engineAccount = tradeEngine.accounts.get(accountId);
  }

  // Keep identity + meta fresh
  if (engineAccount) {
    engineAccount.userId = userId;
    engineAccount.lastIp = ipAddress || engineAccount.lastIp || "SYSTEM";
    engineAccount.commission_per_lot = Number(accountDoc.commission_per_lot) || 0;
    engineAccount.swap_charge = Number(accountDoc.swap_charge) || 0;
    engineAccount.spread_enabled = Boolean(accountDoc.spread_enabled);
  }

  return engineAccount;
}

function findEnginePosition(account, positionKey) {
  if (!account?.positions) return null;
  const key = String(positionKey || "");
  if (!key) return null;

  const direct = account.positions.get(key);
  if (direct) return { positionId: key, position: direct };

  if (/^\d+$/.test(key)) {
    const ticket = Number(key);
    for (const [id, pos] of account.positions.entries()) {
      if (Number(pos.ticket) === ticket) {
        return { positionId: id, position: pos };
      }
    }
  }

  return null;
}

async function ensureInstrumentLoaded(symbol) {
  const code = String(symbol || "").trim().toUpperCase();
  if (!code) return;
  if (tradeEngine.symbols.get(code) || tradeEngine.symbols.get(symbol)) return;

  const instrument = await Instrument.findOne({ code }).lean();
  if (!instrument) return;

  tradeEngine.loadSymbol(instrument.code, {
    segment: instrument.segment
      ? String(instrument.segment).trim().toLowerCase()
      : undefined,
    contractSize: instrument.contractSize,
    maxLeverage: instrument.maxLeverage || 2000,
    spread: Number(instrument.spread) || 0,
    spread_mode:
      typeof instrument.spread_mode === "string"
        ? instrument.spread_mode.trim().toUpperCase()
        : "ADD_ON",
    tickSize: Number(instrument.tickSize) || 0,
    pricePrecision:
      typeof instrument.pricePrecision === "number"
        ? instrument.pricePrecision
        : undefined,
  });
}

async function ensureOpenPositionInEngine(accountDoc, positionKey, ipAddress) {
  const accountId = String(accountDoc._id);
  ensureEngineAccountLoaded(accountDoc, ipAddress);

  let engineAccount = tradeEngine.accounts.get(accountId);
  let found = findEnginePosition(engineAccount, positionKey);
  if (found) {
    await ensureInstrumentLoaded(found.position.symbol);
    return found.positionId;
  }

  const key = String(positionKey || "").trim();
  const accountObjectId = accountDoc._id;

  let trade = await Trade.findOne({
    accountId: accountObjectId,
    status: "OPEN",
    positionId: key,
  }).lean();

  if (!trade && /^\d+$/.test(key)) {
    trade = await Trade.findOne({
      accountId: accountObjectId,
      status: "OPEN",
      ticket: Number(key),
    }).lean();
  }

  if (!trade) {
    throw new Error("Position not found");
  }

  await ensureInstrumentLoaded(trade.symbol);
  tradeEngine.loadOpenPosition(trade);
  engineAccount = tradeEngine.accounts.get(accountId);
  found = findEnginePosition(engineAccount, trade.positionId);
  if (!found) {
    throw new Error("Position not found");
  }

  return found.positionId;
}

async function ensurePendingOrderInEngine(accountDoc, orderKey, ipAddress) {
  const accountId = String(accountDoc._id);
  ensureEngineAccountLoaded(accountDoc, ipAddress);

  let engineAccount = tradeEngine.accounts.get(accountId);
  const key = String(orderKey || "").trim();

  if (engineAccount?.pendingOrders?.get(key)) return key;

  if (engineAccount?.pendingOrders && /^\d+$/.test(key)) {
    const ticket = Number(key);
    for (const [id, order] of engineAccount.pendingOrders.entries()) {
      if (Number(order.ticket) === ticket) return id;
    }
  }

  let order = await PendingOrder.findOne({
    accountId: accountDoc._id,
    status: "PENDING",
    orderId: key,
  }).lean();

  if (!order && /^\d+$/.test(key)) {
    order = await PendingOrder.findOne({
      accountId: accountDoc._id,
      status: "PENDING",
      ticket: Number(key),
    }).lean();
  }

  if (!order) {
    throw new Error("Pending order not found");
  }

  await ensureInstrumentLoaded(order.symbol);
  tradeEngine.loadPendingOrder(order);
  return String(order.orderId);
}

export const getTradeAdminSummary = async (req, res) => {
  try {
    const data = await getTradeAdminSummaryService();

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};

export const adminListBrokerage = async (req, res) => {
  try {
    const result = await adminListBrokerageService(req.query);

    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminListUsersFunds = async (req, res) => {
  try {
    const result = await adminListUsersFundsService(req.query);

    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminListOpenTrades = async (req, res) => {
  try {
    const result = await adminListOpenTradesService(req.query);

    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminListClosedTrades = async (req, res) => {
  try {
    const result = await adminListClosedTradesService(req.query);

    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminListPendingOrdersOpen = async (req, res) => {
  try {
    const result = await adminListPendingOrdersOpenService(req.query);

    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminListPendingOrdersHistory = async (req, res) => {
  try {
    const result = await adminListPendingOrdersHistoryService(req.query);

    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

/* =========================
   ADMIN: TRADE ON BEHALF
========================= */

export const adminPlaceMarketOrder = async (req, res) => {
  try {
    const {
      accountId,
      userId,
      symbol,
      side,
      volume,
      stopLoss = null,
      takeProfit = null,
    } = req.body || {};

    if (!accountId || !userId || !symbol || !side || volume === undefined) {
      return res.status(400).json({
        success: false,
        message: "accountId, userId, symbol, side and volume are required",
      });
    }

    const sideUpper = String(side).trim().toUpperCase();
    if (sideUpper !== "BUY" && sideUpper !== "SELL") {
      return res.status(400).json({
        success: false,
        message: "side must be BUY or SELL",
      });
    }

    const vol = toFiniteNumber(volume, "volume");
    if (vol <= 0) {
      return res.status(400).json({
        success: false,
        message: "volume must be a positive number",
      });
    }

    const account = await getAccountForAdminTrade({ userId, accountId });
    const ip = getRequestIp(req);
    ensureEngineAccountLoaded(account, ip);

    const normalizedSymbol = normalizeSymbol(symbol);

    const pos = tradeEngine.placeMarketOrder({
      ticket: await nextOrderTicket(),
      accountId: String(account._id),
      symbol: normalizedSymbol,
      side: sideUpper,
      volume: vol,
      stopLoss: toOptionalFiniteNumber(stopLoss, "stopLoss"),
      takeProfit: toOptionalFiniteNumber(takeProfit, "takeProfit"),
    });

    return res.json({ success: true, data: pos });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Trade failed",
    });
  }
};

export const adminPlacePendingOrder = async (req, res) => {
  try {
    const {
      accountId,
      userId,
      symbol,
      side,
      orderType,
      price,
      volume,
      stopLoss = null,
      takeProfit = null,
      expireType = "GTC",
      expireAt = null,
    } = req.body || {};

    if (
      !accountId ||
      !userId ||
      !symbol ||
      !side ||
      !orderType ||
      price === undefined ||
      volume === undefined
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const sideUpper = String(side).trim().toUpperCase();
    if (sideUpper !== "BUY" && sideUpper !== "SELL") {
      return res.status(400).json({
        success: false,
        message: "side must be BUY or SELL",
      });
    }

    const vol = toFiniteNumber(volume, "volume");
    const pr = toFiniteNumber(price, "price");

    if (vol <= 0) {
      return res.status(400).json({
        success: false,
        message: "volume must be a positive number",
      });
    }

    const account = await getAccountForAdminTrade({ userId, accountId });
    const ip = getRequestIp(req);
    ensureEngineAccountLoaded(account, ip);

    const normalizedSymbol = normalizeSymbol(symbol);

    const order = tradeEngine.placePendingOrder({
      ticket: await nextOrderTicket(),
      userId: String(account.user_id),
      accountId: String(account._id),
      symbol: normalizedSymbol,
      side: sideUpper,
      orderType: String(orderType).trim().toUpperCase(),
      price: pr,
      volume: vol,
      stopLoss: toOptionalFiniteNumber(stopLoss, "stopLoss"),
      takeProfit: toOptionalFiniteNumber(takeProfit, "takeProfit"),
      expireType,
      expireAt,
    });

    return res.json({ success: true, data: order });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Pending order failed",
    });
  }
};

export const adminModifyPendingOrder = async (req, res) => {
  try {
    const { accountId, userId, orderId, price, volume, stopLoss, takeProfit } =
      req.body || {};

    if (!accountId || !userId || !orderId) {
      return res.status(400).json({
        success: false,
        message: "accountId, userId and orderId are required",
      });
    }

    const normalized = normalizePendingOrderEdit({
      price,
      volume,
      stopLoss,
      takeProfit,
    });

    const account = await getAccountForAdminTrade({ userId, accountId });
    const ip = getRequestIp(req);
    const resolvedOrderId = await ensurePendingOrderInEngine(
      account,
      orderId,
      ip
    );

    const updated = tradeEngine.modifyPendingOrder({
      accountId: String(account._id),
      orderId: resolvedOrderId,
      price:
        normalized.price.kind === "set" ? normalized.price.value : undefined,
      volume:
        normalized.volume.kind === "set" ? normalized.volume.value : undefined,
      stopLoss:
        normalized.stopLoss.kind === "omit"
          ? undefined
          : resolveOptionalField(normalized.stopLoss, null),
      takeProfit:
        normalized.takeProfit.kind === "omit"
          ? undefined
          : resolveOptionalField(normalized.takeProfit, null),
    });

    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminCancelPendingOrder = async (req, res) => {
  try {
    const { accountId, userId, orderId } = req.body || {};

    if (!accountId || !userId || !orderId) {
      return res.status(400).json({
        success: false,
        message: "accountId, userId and orderId are required",
      });
    }

    const account = await getAccountForAdminTrade({ userId, accountId });
    const ip = getRequestIp(req);
    ensureEngineAccountLoaded(account, ip);

    tradeEngine.cancelPendingOrder({ accountId: String(account._id), orderId: String(orderId) });

    return res.json({ success: true });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminModifyPosition = async (req, res) => {
  try {
    const {
      accountId,
      userId,
      positionId,
      volume,
      openPrice,
      stopLoss,
      takeProfit,
    } = req.body || {};

    if (!accountId || !userId || !positionId) {
      return res.status(400).json({
        success: false,
        message: "accountId, userId and positionId are required",
      });
    }

    const normalized = normalizeLivePositionEdit({
      volume,
      openPrice,
      stopLoss,
      takeProfit,
    });

    const account = await getAccountForAdminTrade({ userId, accountId });
    const ip = getRequestIp(req);
    const resolvedPositionId = await ensureOpenPositionInEngine(
      account,
      positionId,
      ip
    );

    const result = tradeEngine.modifyPosition({
      accountId: String(account._id),
      positionId: resolvedPositionId,
      volume:
        normalized.volume.kind === "set" ? normalized.volume.value : undefined,
      openPrice:
        normalized.openPrice.kind === "set"
          ? normalized.openPrice.value
          : undefined,
      stopLoss:
        normalized.stopLoss.kind === "omit"
          ? undefined
          : resolveOptionalField(normalized.stopLoss, null),
      takeProfit:
        normalized.takeProfit.kind === "omit"
          ? undefined
          : resolveOptionalField(normalized.takeProfit, null),
    });

    // Persist immediately so admin list/PnL refetch is not racing LedgerQueue.
    await Trade.updateOne(
      { positionId: result.positionId, status: "OPEN" },
      {
        $set: {
          volume: result.volume,
          openPrice: result.openPrice,
          entryPrice: result.openPrice,
          stopLoss: result.stopLoss ?? null,
          takeProfit: result.takeProfit ?? null,
          grossPnL: Number(result.floatingPnL) || 0,
        },
      }
    );

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminModifyClosedTrade = async (req, res) => {
  try {
    const actorId = req.user?._id || req.user?.id || null;
    const result = await adminEditClosedTradeService(req.body || {}, {
      actorId,
    });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Closed trade edit failed",
    });
  }
};

export const adminDeleteTrade = async (req, res) => {
  try {
    const actorId = req.user?._id || req.user?.id || null;
    const result = await adminDeleteTradeService(req.body || {}, { actorId });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Trade delete failed",
    });
  }
};

export const adminRestoreTrade = async (req, res) => {
  try {
    const actorId = req.user?._id || req.user?.id || null;
    const result = await adminRestoreTradeService(req.body || {}, { actorId });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Trade restore failed",
    });
  }
};

export const adminListDeletedTrades = async (req, res) => {
  try {
    const result = await adminListDeletedTradesService(req.query || {});
    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to list deleted trades",
    });
  }
};

export const adminClosePosition = async (req, res) => {
  try {
    const { accountId, userId, positionId } = req.body || {};

    if (!accountId || !userId || !positionId) {
      return res.status(400).json({
        success: false,
        message: "accountId, userId and positionId are required",
      });
    }

    const account = await getAccountForAdminTrade({ userId, accountId });
    const ip = getRequestIp(req);
    const resolvedPositionId = await ensureOpenPositionInEngine(
      account,
      positionId,
      ip
    );

    const result = tradeEngine.squareOffPosition({
      accountId: String(account._id),
      positionId: resolvedPositionId,
      reason: "MANUAL",
      closeTicket: await nextOrderTicket(),
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message,
    });
  }
};

export const adminBulkCreatePositionHistory = async (req, res) => {
  try {
    const { accountId, userId, positions, applyToBalance = true } = req.body || {};

    if (!accountId || !userId) {
      return res.status(400).json({
        success: false,
        message: "accountId and userId are required",
      });
    }

    if (!Array.isArray(positions) || positions.length === 0) {
      return res.status(400).json({
        success: false,
        message: "positions must be a non-empty array",
      });
    }

    if (positions.length > 1000) {
      return res.status(400).json({
        success: false,
        message: "Maximum 1000 positions allowed per request",
      });
    }

    const account = await getAccountForAdminTrade({ userId, accountId });
    const ipAddress = getRequestIp(req);

    const symbolSet = new Set();
    for (const row of positions) {
      if (row?.symbol) symbolSet.add(normalizeSymbol(row.symbol));
    }

    const instruments = await Instrument.find({
      code: { $in: [...symbolSet] },
    })
      .select({ code: 1, contractSize: 1 })
      .lean();

    const contractSizeBySymbol = new Map(
      instruments.map((item) => [String(item.code).toUpperCase(), Number(item.contractSize) || 1])
    );

    const docs = positions.map((row, index) => {
      const symbol = normalizeSymbol(row?.symbol);
      const side = String(row?.type || row?.side || "")
        .trim()
        .toUpperCase();

      if (!symbol) {
        throw new Error(`positions[${index}].symbol is required`);
      }

      if (side !== "BUY" && side !== "SELL") {
        throw new Error(`positions[${index}].type/side must be BUY or SELL`);
      }

      const volume = toFiniteNumber(row?.volume, `positions[${index}].volume`);
      if (volume <= 0) {
        throw new Error(`positions[${index}].volume must be greater than 0`);
      }

      const openPrice = toFiniteNumber(
        row?.price ?? row?.openPrice,
        `positions[${index}].price/openPrice`
      );
      const closePrice = toFiniteNumber(
        row?.closePrice,
        `positions[${index}].closePrice`
      );

      const openTime = toDate(row?.openTime, `positions[${index}].openTime`);
      const closeTime = toDate(row?.closeTime, `positions[${index}].closeTime`);

      if (closeTime < openTime) {
        throw new Error(`positions[${index}].closeTime must be >= openTime`);
      }

      const contractSize = contractSizeBySymbol.get(symbol) || 1;
      const leverage = Number(account.leverage) || 1;
      const marginUsed = (openPrice * volume * contractSize) / leverage;

      const positionId = generateHistoryPositionId(index);
      const commission =
        toOptionalFiniteNumber(row?.commission, `positions[${index}].commission`) || 0;
      const swap = toOptionalFiniteNumber(row?.swap, `positions[${index}].swap`) || 0;
      const profit = toOptionalFiniteNumber(row?.profit, `positions[${index}].profit`) || 0;

      return {
        userId: new mongoose.Types.ObjectId(userId),
        accountId: new mongoose.Types.ObjectId(accountId),
        ipAddress,
        positionId,
        symbol,
        side,
        orderType: "MARKET",
        status: "CLOSED",
        volume,
        contractSize,
        leverage,
        openPrice,
        entryPrice: openPrice,
        closePrice,
        stopLoss: toOptionalFiniteNumber(row?.sl ?? row?.stopLoss, `positions[${index}].sl/stopLoss`),
        takeProfit: toOptionalFiniteNumber(
          row?.tp ?? row?.takeProfit,
          `positions[${index}].tp/takeProfit`
        ),
        marginUsed,
        grossPnL: profit,
        commission,
        swap,
        realizedPnL: profit,
        openTime,
        closeTime,
        closeReason: "MANUAL",
        metadata: {
          source: "ADMIN_HISTORY_IMPORT",
        },
      };
    });

    const session = await mongoose.startSession();
    let inserted = [];
    let newBalance = Number(account.balance) || 0;
    let newEquity = Number(account.equity) || newBalance;
    const bonusBalance = Number(account.bonus_balance) || 0;

    try {
      await session.withTransaction(async () => {
        inserted = await Trade.insertMany(docs, { ordered: true, session });

        const byPositionId = new Map(
          inserted.map((tradeDoc) => [String(tradeDoc.positionId), tradeDoc])
        );

        const transactionsToInsert = [];
        const docsByCloseTime = [...docs].sort(
          (a, b) => new Date(a.closeTime).getTime() - new Date(b.closeTime).getTime()
        );

        for (const tradeDoc of docsByCloseTime) {
          const linkedTrade = byPositionId.get(String(tradeDoc.positionId));
          if (!linkedTrade?._id) {
            throw new Error(`Trade not found after insert for ${tradeDoc.positionId}`);
          }

          const realized = Number(tradeDoc.realizedPnL) || 0;
          const commission = Number(tradeDoc.commission) || 0;
          const swap = Number(tradeDoc.swap) || 0;

          const pnlDelta = applyToBalance ? realized : 0;
          const commissionDelta = applyToBalance ? -commission : 0;
          const swapDelta = applyToBalance ? -swap : 0;

          const nextBalance = Number((newBalance + pnlDelta + commissionDelta + swapDelta).toFixed(8));
          if (nextBalance < 0) {
            throw new Error(
              `Import would make account balance negative at position ${tradeDoc.positionId}. Add deposit first or set applyToBalance=false`
            );
          }

          newBalance = nextBalance;
          newEquity = Number((newBalance + bonusBalance).toFixed(8));

          transactionsToInsert.push({
            user: new mongoose.Types.ObjectId(userId),
            account: new mongoose.Types.ObjectId(accountId),
            type: realized >= 0 ? "TRADE_PROFIT" : "TRADE_LOSS",
            amount: Math.abs(realized),
            balanceAfter: newBalance,
            equityAfter: newEquity,
            status: "SUCCESS",
            referenceType: "TRADE",
            referenceId: linkedTrade._id,
            createdBy: req.user?._id || null,
            remark:
              realized >= 0
                ? `Imported trade profit (${tradeDoc.positionId})`
                : `Imported trade loss (${tradeDoc.positionId})`,
            createdAt: new Date(tradeDoc.closeTime),
            updatedAt: new Date(tradeDoc.closeTime),
          });

          if (commission > 0) {
            transactionsToInsert.push({
              user: new mongoose.Types.ObjectId(userId),
              account: new mongoose.Types.ObjectId(accountId),
              type: "ADJUSTMENT",
              amount: commission,
              balanceAfter: newBalance,
              equityAfter: newEquity,
              status: "SUCCESS",
              referenceType: "ORDER",
              referenceId: linkedTrade._id,
              createdBy: req.user?._id || null,
              remark: `Imported commission (${tradeDoc.positionId})`,
              createdAt: new Date(tradeDoc.openTime),
              updatedAt: new Date(tradeDoc.openTime),
            });
          }

          if (swap !== 0) {
            transactionsToInsert.push({
              user: new mongoose.Types.ObjectId(userId),
              account: new mongoose.Types.ObjectId(accountId),
              type: "SWAP",
              amount: Math.abs(swap),
              balanceAfter: newBalance,
              equityAfter: newEquity,
              status: "SUCCESS",
              referenceType: "ORDER",
              referenceId: linkedTrade._id,
              createdBy: req.user?._id || null,
              remark:
                swap > 0
                  ? `Imported overnight swap charged (${tradeDoc.positionId})`
                  : `Imported overnight swap credited (${tradeDoc.positionId})`,
              createdAt: new Date(tradeDoc.closeTime),
              updatedAt: new Date(tradeDoc.closeTime),
            });
          }
        }

        await Transaction.insertMany(transactionsToInsert, { ordered: true, session });

        if (applyToBalance) {
          await Account.updateOne(
            { _id: new mongoose.Types.ObjectId(accountId) },
            { $set: { balance: newBalance, equity: newEquity } },
            { session }
          );
        }
      });
    } finally {
      await session.endSession();
    }

    if (applyToBalance) {
      try {
        publishAccountBalance(String(accountId), newBalance, Number(account.bonus_balance || 0));
      } catch {}
    }

    return res.json({
      success: true,
      message: "Position history bulk created successfully",
      data: {
        accountId,
        userId,
        insertedCount: inserted.length,
        applyToBalance: Boolean(applyToBalance),
        balanceAfter: Number(newBalance.toFixed(2)),
      },
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create position history",
    });
  }
};
