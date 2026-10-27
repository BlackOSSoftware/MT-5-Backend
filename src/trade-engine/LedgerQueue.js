import Account from "../models/Account.model.js";
import Trade from "../models/Trade.model.js";
import Transaction from "../models/Transaction.model.js";
import PendingOrder from "../models/PendingOrder.model.js";
import Brokerage from "../models/Brokerage.model.js";
import { engineEvents } from "./EngineEvents.js";
import {
  publishAccountBalance,
  publishPositionClosed,
} from "./EngineSyncBus.js";
import { consumeNonWithdrawableBalance } from "../utils/nonWithdrawable.util.js";
import {
  nextDealTicket,
  nextOrderTicket,
} from "../services/orderTicket.service.js";
import { getUserBrokerId } from "../utils/brokerScope.js";

class LedgerQueue {
  constructor() {
    this.queue = [];
    this.processing = false;

    engineEvents.on("ledger", (job) => {
      this.queue.push(job);
      this.scheduleDrain();
    });

    console.log("[LEDGER] LedgerQueue initialized");
  }

  enqueue(event, payload) {
    setImmediate(() => {
      engineEvents.emit("ledger", { event, payload });
    });
  }

  /** Await DB persistence (manual close must finish before HTTP returns). */
  enqueueAndWait(event, payload) {
    return new Promise((resolve, reject) => {
      this.queue.push({
        event,
        payload,
        __resolve: resolve,
        __reject: reject,
      });
      this.scheduleDrain();
    });
  }

  scheduleDrain() {
    if (this.processing) return;

    this.processing = true;

    setImmediate(() => {
      this.drain().catch((err) => {
        console.error("[LEDGER][FATAL]", err);
      });
    });
  }

  async drain() {
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();

        try {
          const result = await this.process(job);
          if (typeof job.__resolve === "function") job.__resolve(result);
        } catch (err) {
          console.error("[LEDGER][FATAL]", err);
          if (typeof job.__reject === "function") job.__reject(err);
        }
      }
    } finally {
      this.processing = false;

      if (this.queue.length > 0) {
        this.scheduleDrain();
      }
    }
  }

  async process({ event, payload }) {
    console.log("[LEDGER] EVENT RECEIVED:", event);

    switch (event) {
      /* ================= TRADE ================= */

      case "TRADE_OPEN":
        await this.tradeOpen(payload);
        break;

      case "TRADE_CLOSE":
        return await this.tradeClose(payload);

      case "POSITION_MODIFY":
        await this.positionModify(payload);
        break;

      /* ================= PENDING ================= */

      case "ORDER_PENDING_CREATE":
        await this.pendingCreate(payload);
        break;

      case "ORDER_PENDING_MODIFY":
        await this.pendingModify(payload);
        break;

      case "ORDER_PENDING_EXECUTE":
        await this.pendingExecute(payload);
        break;

      case "ORDER_PENDING_CANCEL":
        await this.pendingCancel(payload);
        break;

      case "ORDER_PENDING_EXECUTE_FAILED":
        await this.pendingFailed(payload);
        break;

      default:
        console.warn("[LEDGER] UNKNOWN EVENT:", event);
    }
  }

  /* =========================
     TRADE OPEN
  ========================= */

  async tradeOpen({
    userId,
    accountId,
    ipAddress,
    positionId,
    ticket,
    symbol,
    side,
    orderType,
    volume,
    contractSize,
    leverage,
    openPrice,
    stopLoss,
    takeProfit,
    marginUsed,
    spread,
    commissionCharged,
    swapPerDay,
  }) {
    const resolvedUserId =
      userId ||
      (await Account.findById(accountId).select("user_id"))?.user_id;

    if (!resolvedUserId) {
      throw new Error("Ledger tradeOpen: userId not resolved");
    }

    if (typeof marginUsed !== "number") {
      throw new Error("Ledger tradeOpen: marginUsed missing");
    }

    const stampBrokerId = await getUserBrokerId(resolvedUserId);

    const trade = await Trade.create({
      userId: resolvedUserId,
      accountId,
      ipAddress: ipAddress || "SYSTEM",
      ...(stampBrokerId ? { brokerId: stampBrokerId } : {}),

      positionId,
      ticket,
      openDealTicket: await nextDealTicket(),
      symbol,
      side,
      orderType,
      status: "OPEN",

      volume,
      contractSize,
      leverage,
      openPrice,
      entryPrice: openPrice,

      stopLoss: stopLoss ?? null,
      takeProfit: takeProfit ?? null,

      marginUsed,
      commission: typeof commissionCharged === "number" ? commissionCharged : 0,
      spread: typeof spread === "number" ? spread : 0,
      swap: typeof swapPerDay === "number" ? swapPerDay : 0,
      openTime: new Date(),
      engineVersion: "ENGINE_V1",
    });

    console.log("[LEDGER][TRADE_OPEN][OK]", trade._id.toString());
  }

  /* =========================
     POSITION MODIFY (SL / TP)
  ========================= */

  async positionModify({
    positionId,
    stopLoss,
    takeProfit,
    volume,
    openPrice,
    marginUsed,
  }) {
    const $set = {
      stopLoss: stopLoss ?? null,
      takeProfit: takeProfit ?? null,
    };
    if (typeof volume === "number" && Number.isFinite(volume)) {
      $set.volume = volume;
    }
    if (typeof openPrice === "number" && Number.isFinite(openPrice)) {
      $set.openPrice = openPrice;
      $set.entryPrice = openPrice;
    }
    if (typeof marginUsed === "number" && Number.isFinite(marginUsed)) {
      $set.marginUsed = marginUsed;
    }

    await Trade.updateOne({ positionId, status: "OPEN" }, { $set });

    console.log("[LEDGER][POSITION_MODIFY][OK]", positionId);
  }

  /* =========================
     TRADE CLOSE
  ========================= */

  async tradeClose({
    userId,
    accountId,
    positionId,
    closeTicket,
    closePrice,
    realizedPnL,
    reason,
    bonusDeduct,
    bonusBalance,
    realBalanceExhaustedByLoss,
    bonusPercent,
  }) {
    const pnl = Number(realizedPnL);

    if (Number.isNaN(pnl)) {
      throw new Error("Ledger tradeClose: realizedPnL is NaN");
    }

    // SL / TP / stop-out closes engine ke andar sync hote hain, unka
    // close ticket yahan banta hai.
    const outTicket =
      typeof closeTicket === "number" ? closeTicket : await nextOrderTicket();

    const trade = await Trade.findOneAndUpdate(
      { positionId, status: { $in: ["OPEN", "CLOSING"] } },
      {
        $set: {
          closeTicket: outTicket,
          closeDealTicket: await nextDealTicket(),
          closePrice,
          realizedPnL: pnl,
          closeReason: reason,
          closeTime: new Date(),
          status: "CLOSED",
        },
      },
      { new: true }
    );

    if (!trade) {
      // Already closed by another worker/client — still clear RAM everywhere.
      const existing = await Trade.findOne({ positionId }).select(
        "status accountId realizedPnL",
      ).lean();
      if (existing?.status === "CLOSED") {
        publishPositionClosed(
          String(accountId || existing.accountId || ""),
          String(positionId),
        );
        console.log("[LEDGER][TRADE_CLOSE][ALREADY_CLOSED]", positionId);
        return { alreadyClosed: true, positionId, realizedPnL: existing.realizedPnL };
      }
      console.error("[LEDGER][TRADE_CLOSE] Trade not found", positionId);
      return { alreadyClosed: false, positionId, missing: true };
    }

    const account = await Account.findById(accountId);

    if (!account) {
      console.error("[LEDGER][TRADE_CLOSE] Account not found", accountId);
      return;
    }

    const currentRealBalance = Number(account.balance || 0);
    const currentBonus = Number(account.bonus_balance || 0);
    const currentLockedBalance = Number(account.non_withdrawable_balance || 0);
    const projectedBalanceAfter = Math.max(0, currentRealBalance + pnl);
    const shouldExhaustBonus =
      pnl < 0 &&
      (realBalanceExhaustedByLoss === true || projectedBalanceAfter <= 0);
    let bonusDeductValue = Number(bonusDeduct);
    if (!Number.isFinite(bonusDeductValue) || bonusDeductValue < 0) {
      bonusDeductValue = 0;
    }
    if (shouldExhaustBonus) {
      // Recalculate from the persisted value so the database remains the
      // source of truth even if an engine worker had a stale bonus snapshot.
      bonusDeductValue = currentBonus;
    } else if (bonusDeductValue === 0 && pnl < 0) {
      bonusDeductValue = Math.min(
        currentBonus,
        Math.max(0, Math.abs(pnl) - currentRealBalance),
      );
    }
    const requestedBonusBalance = Number(bonusBalance);
    const newBonusBalance = shouldExhaustBonus
      ? 0
      : Number.isFinite(requestedBonusBalance)
        ? Math.max(0, requestedBonusBalance)
        : bonusDeductValue > 0
          ? Math.max(0, currentBonus - bonusDeductValue)
          : currentBonus;
    const nextLockedBalance =
      pnl < 0
        ? consumeNonWithdrawableBalance({
            currentLocked: currentLockedBalance,
            amount: Math.abs(pnl),
            balanceAfter: projectedBalanceAfter,
          })
        : Math.min(projectedBalanceAfter, currentLockedBalance);

    const accountAfter = await Account.findOneAndUpdate(
      { _id: accountId },
      [
        {
          $set: {
            balance: {
              $max: [0, { $add: [{ $ifNull: ["$balance", 0] }, pnl] }],
            },
            bonus_balance: newBonusBalance,
            non_withdrawable_balance: nextLockedBalance,
          },
        },
        {
          $set: {
            equity: {
              $add: [
                { $ifNull: ["$balance", 0] },
                { $ifNull: ["$bonus_balance", 0] },
              ],
            },
          },
        },
      ],
      { new: true, updatePipeline: true }
    );

    if (!accountAfter) {
      console.error("[LEDGER][TRADE_CLOSE] Account update failed", accountId);
      return;
    }

    const newBalance = Number(accountAfter.balance);
    const persistedBonusBalance = Number(accountAfter.bonus_balance || 0);
    const newEquity = Number(accountAfter.equity ?? newBalance + persistedBonusBalance);

    // Fanout: keep other Node workers' RAM in sync (balance + drop closed position).
    publishAccountBalance(String(accountId), newBalance, persistedBonusBalance);
    publishPositionClosed(
      String(accountId),
      String(positionId),
      newBalance,
      persistedBonusBalance,
    );

    const txn = await Transaction.create({
      user: userId || trade.userId,
      account: accountId,
      type: pnl >= 0 ? "TRADE_PROFIT" : "TRADE_LOSS",
      amount: Math.abs(pnl),
      balanceAfter: newBalance,
      equityAfter: newEquity,
      referenceType: "TRADE",
      referenceId: trade._id,
      status: "SUCCESS",
        remark:
          pnl >= 0
            ? "Trade profit credited"
            : "Trade loss debited",
      createdAt: new Date(),
    });

    await Brokerage.create({
      user_id: trade.userId,
      account_id: trade.accountId,
      trade_id: trade._id,
      symbol: trade.symbol,
      spread: typeof trade.spread === "number" ? trade.spread : 0,
      commission: typeof trade.commission === "number" ? trade.commission : 0,
      swap: typeof trade.swap === "number" ? trade.swap : 0,
      pnl,
    });

    if (bonusDeductValue > 0) {
      await Transaction.create({
        user: userId || trade.userId,
        account: accountId,
        type: "BONUS_CREDIT_OUT",
        amount: bonusDeductValue,
        balanceAfter: newBalance,
        equityAfter: newEquity,
        referenceType: "TRADE",
        referenceId: trade._id,
        status: "SUCCESS",
        remark: shouldExhaustBonus
          ? "Bonus fully removed because trading loss exhausted real balance"
          : "Bonus consumed after real balance was exhausted",
        createdAt: new Date(),
      });
    }

    console.log("[LEDGER][TRADE_CLOSE][OK]", {
      tradeId: trade._id.toString(),
      txnId: txn._id.toString(),
      pnl,
    });

    return {
      alreadyClosed: false,
      positionId,
      realizedPnL: pnl,
      balance: newBalance,
      bonusBalance: persistedBonusBalance,
    };
  }

  /* =========================
     PENDING CREATE
  ========================= */

  async pendingCreate(order) {
    const stampBrokerId = await getUserBrokerId(order.userId);
    await PendingOrder.create({
      orderId: order.orderId,
      ticket: order.ticket,
      userId: order.userId,
      accountId: order.accountId,
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      price: order.price,
      limitPrice: order.limitPrice ?? null,
      volume: order.volume,
      stopLoss: order.stopLoss ?? null,
      takeProfit: order.takeProfit ?? null,
      expireType: order.expireType || "GTC",
      expireAt: order.expireAt ? new Date(order.expireAt) : null,
      status: "PENDING",
      createdAt: new Date(order.createdAt),
      ...(stampBrokerId ? { brokerId: stampBrokerId } : {}),
    });

    console.log("[LEDGER][PENDING_CREATE][OK]", order.orderId);
  }

  /* =========================
     PENDING MODIFY (also used for STOP_LIMIT -> LIMIT conversion)
  ========================= */

  async pendingModify(order) {
    const $set = {
      orderType: order.orderType,
      price: order.price,
      limitPrice: order.limitPrice ?? null,
      stopLoss: order.stopLoss ?? null,
      takeProfit: order.takeProfit ?? null,
    };
    if (typeof order.volume === "number" && Number.isFinite(order.volume)) {
      $set.volume = order.volume;
    }

    await PendingOrder.updateOne({ orderId: order.orderId }, { $set });

    console.log("[LEDGER][PENDING_MODIFY][OK]", order.orderId);
  }

  /* =========================
     PENDING EXECUTE
  ========================= */

  async pendingExecute(order) {
    await PendingOrder.updateOne(
      { orderId: order.orderId },
      {
        $set: {
          status: "EXECUTED",
          executedAt: new Date(),
        },
      }
    );

    console.log("[LEDGER][PENDING_EXECUTE][OK]", order.orderId);
  }

  /* =========================
     PENDING CANCEL
  ========================= */

  async pendingCancel({ orderId, reason }) {
    // Expiration wala cancel EXPIRED status me jayega,
    // user ka manual cancel CANCELLED me.
    const expired = reason === "EXPIRED";
    await PendingOrder.updateOne(
      { orderId },
      {
        $set: {
          status: expired ? "EXPIRED" : "CANCELLED",
          cancelledAt: new Date(),
        },
      }
    );

    console.log("[LEDGER][PENDING_CANCEL][OK]", orderId);
  }

  /* =========================
     PENDING FAILED (NEW)
  ========================= */

  async pendingFailed({ orderId, reason }) {
    await PendingOrder.updateOne(
      { orderId },
      {
        $set: {
          status: "FAILED",
          failReason: reason || "EXECUTION_FAILED",
          failedAt: new Date(),
        },
      }
    );

    console.log("[LEDGER][PENDING_FAILED][OK]", orderId, reason);
  }
}

export const ledgerQueue = new LedgerQueue();
