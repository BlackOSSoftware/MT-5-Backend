import mongoose from "mongoose";
import Trade from "../models/Trade.model.js";
import Account from "../models/Account.model.js";
import {
  applyBalanceDelta,
  computeBalanceDelta,
  mergeClosedTradeFields,
  normalizeCloseReasonValue,
  normalizeClosedTradeEdit,
  resolveClosedTradePnL,
} from "./adminTradeEdit.validation.js";
import {
  ACTIVITY_ACTIONS,
  ACTOR_TYPES,
  recordActivity,
} from "./activity.service.js";

export async function adminEditClosedTradeService(body = {}, { actorId } = {}) {
  const { accountId, userId, positionId, tradeId } = body;

  if (!accountId || !userId) {
    throw new Error("accountId and userId are required");
  }
  if (!positionId && !tradeId) {
    throw new Error("positionId or tradeId is required");
  }
  if (!mongoose.isValidObjectId(accountId) || !mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid accountId or userId");
  }

  const normalized = normalizeClosedTradeEdit(body);

  const filter = {
    status: "CLOSED",
    accountId: new mongoose.Types.ObjectId(accountId),
    userId: new mongoose.Types.ObjectId(userId),
  };
  if (positionId) filter.positionId = String(positionId);
  if (tradeId) {
    if (!mongoose.isValidObjectId(tradeId)) throw new Error("Invalid tradeId");
    filter._id = new mongoose.Types.ObjectId(tradeId);
  }

  const trade = await Trade.findOne(filter);
  if (!trade) throw new Error("Closed trade not found");

  const account = await Account.findOne({
    _id: trade.accountId,
    user_id: trade.userId,
  });
  if (!account) throw new Error("Account not found");

  const oldPnL = Number(trade.realizedPnL) || 0;
  const merged = mergeClosedTradeFields(
    {
      volume: trade.volume,
      openPrice: trade.openPrice,
      closePrice: trade.closePrice,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
      commission: trade.commission,
      spread: trade.spread,
      swap: trade.swap,
      realizedPnL: trade.realizedPnL,
      closeReason: trade.closeReason,
    },
    normalized
  );

  const { grossPnL, realizedPnL: newPnL } = resolveClosedTradePnL({
    side: trade.side,
    volume: merged.volume,
    openPrice: merged.openPrice,
    closePrice: merged.closePrice,
    contractSize: trade.contractSize,
    normalized,
    previousRealizedPnL: oldPnL,
  });

  const delta = computeBalanceDelta(oldPnL, newPnL);
  const nextBalance = applyBalanceDelta(account.balance, delta);

  trade.volume = merged.volume;
  trade.openPrice = merged.openPrice;
  trade.entryPrice = merged.openPrice;
  trade.closePrice = merged.closePrice;
  trade.stopLoss = merged.stopLoss;
  trade.takeProfit = merged.takeProfit;
  trade.commission = merged.commission;
  trade.spread = merged.spread;
  trade.swap = merged.swap;
  trade.grossPnL = grossPnL;
  trade.realizedPnL = newPnL;
  try {
    trade.closeReason = normalizeCloseReasonValue(merged.closeReason);
  } catch {
    trade.closeReason = "MANUAL";
  }
  await trade.save();

  if (delta !== 0) {
    account.balance = nextBalance;
    await account.save();
  }

  await recordActivity({
    userId: String(trade.userId),
    action: ACTIVITY_ACTIONS.TRADE_CLOSED_EDITED_BY_ADMIN,
    actorId: actorId ? String(actorId) : null,
    actorType: ACTOR_TYPES.ADMIN,
  });

  return {
    trade,
    balanceDelta: delta,
    balance: account.balance,
    pnlAutoRecalculated:
      normalized.volume?.kind === "set" ||
      normalized.openPrice?.kind === "set" ||
      normalized.closePrice?.kind === "set",
  };
}
