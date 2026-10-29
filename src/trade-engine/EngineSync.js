// src/trade-engine/EngineSync.js

import { tradeEngine } from "./bootstrap.js";
import AccountModel from "../models/Account.model.js";
import InstrumentModel from "../models/Instrument.model.js";
import Trade from "../models/Trade.model.js";
import PendingOrder from "../models/PendingOrder.model.js";

/**
 * EngineSync
 * ------------------
 * Keeps Trade Engine in sync with DB updates
 * (deposit, withdrawal, transfer, block, create, etc.)
 */
class EngineSync {
  /* ===========================
     LOAD / REFRESH ACCOUNT
  ============================ */

  static applyAccountSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object") return;

    const accountId = snapshot.accountId ?? snapshot._id ?? snapshot.id;
    if (!accountId) return;

    tradeEngine.loadAccount({
      accountId: String(accountId),
      balance: Number(snapshot.balance),
      leverage: Number(snapshot.leverage),
      userId:
        snapshot.userId != null
          ? String(snapshot.userId)
          : snapshot.user_id != null
            ? String(snapshot.user_id)
            : null,
      lastIp: snapshot.lastIp || null,

      commission_per_lot: Number(snapshot.commission_per_lot || 0),
      swap_charge: Number(snapshot.swap_charge || 0),
      spread_enabled: snapshot.spread_enabled === true,
      bonus_balance: Number(snapshot.bonus_balance || 0),
      bonus_percent_override:
        typeof snapshot.bonus_percent_override === "number"
          ? snapshot.bonus_percent_override
          : snapshot.bonus_percent_override === null
            ? null
            : undefined,
      brokerId:
        snapshot.brokerId != null ? String(snapshot.brokerId) : undefined,

      account_type: snapshot.account_type,
      status: snapshot.status,
    });
  }

  static async syncAccount(accountId) {
    const account = await AccountModel.findById(accountId).lean();

    if (!account) {
      console.warn("[ENGINE_SYNC] account not found:", accountId);
      return;
    }

    this.applyAccountSnapshot(account);

    console.log("[ENGINE_SYNC] synced:", {
      id: String(account._id),
      balance: account.balance,
      leverage: account.leverage,
      spread: account.spread_enabled,
      status: account.status,
    });
  }

  /**
   * Force-refresh account money + restore any OPEN positions / PENDING orders
   * that are in DB but missing from engine RAM (common after deposit or restart races).
   */
  static async refreshAccountForLive(accountId) {
    const id = String(accountId || "");
    if (!id) return null;

    await this.syncAccount(id);
    const acc = tradeEngine.accounts.get(id);
    if (!acc) return null;

    const [openTrades, pendingOrders] = await Promise.all([
      Trade.find({
        accountId: id,
        status: "OPEN",
        isDeleted: { $ne: true },
      }).lean(),
      PendingOrder.find({
        accountId: id,
        status: "PENDING",
        isDeleted: { $ne: true },
      }).lean(),
    ]);

    for (const trade of openTrades) {
      const posId = String(trade.positionId || "");
      if (!posId) continue;
      if (acc.positions?.has?.(posId)) continue;
      try {
        tradeEngine.loadOpenPosition(trade);
      } catch (err) {
        console.warn(
          "[ENGINE_SYNC] loadOpenPosition failed",
          posId,
          err?.message || err,
        );
      }
    }

    for (const order of pendingOrders) {
      const orderId = String(order.orderId || order._id || "");
      if (!orderId) continue;
      if (acc.pendingOrders?.has?.(orderId)) continue;
      try {
        tradeEngine.loadPendingOrder(order);
      } catch (err) {
        console.warn(
          "[ENGINE_SYNC] loadPendingOrder failed",
          orderId,
          err?.message || err,
        );
      }
    }

    acc.recalc?.();
    return acc;
  }

  /* ===========================
     BALANCE UPDATE
  ============================ */

  static async updateBalance(accountId, newBalance, options = {}) {
    const id = String(accountId);
    let acc = tradeEngine.accounts.get(id);

    if (!acc) {
      await this.syncAccount(id);
      acc = tradeEngine.accounts.get(id);
      if (!acc) return;
    }

    const hasBalance = newBalance !== undefined && newBalance !== null;
    const b = hasBalance ? Number(newBalance) : NaN;
    if (hasBalance && Number.isFinite(b)) {
      acc.balance = b;
    }

    if (options && options.bonusBalance !== undefined) {
      const bb = Number(options.bonusBalance);
      if (Number.isFinite(bb)) {
        acc.bonus_balance = bb;
      }
    }

    if (options && options.bonusPercentOverride !== undefined) {
      acc.bonus_percent_override =
        typeof options.bonusPercentOverride === "number"
          ? options.bonusPercentOverride
          : options.bonusPercentOverride === null
            ? null
            : acc.bonus_percent_override;

      const override =
        typeof acc.bonus_percent_override === "number"
          ? acc.bonus_percent_override
          : null;
      let effective =
        tradeEngine.bonusEnabled && override !== null
          ? override
          : tradeEngine.bonusEnabled
            ? tradeEngine.bonusPercentDefault
            : 0;
      if (!Number.isFinite(effective) || effective < 0) effective = 0;
      acc.bonus_percent = effective;
    }

    acc.recalc();

    console.log("[ENGINE_SYNC] balance updated:", id, hasBalance ? b : "no-op");
  }

  /* ===========================
     ACCOUNT STATUS
  ============================ */

  static async setAccountStatus(accountId, isActive) {
    const acc = tradeEngine.accounts.get(String(accountId));

    if (!acc) return;

    acc.isBlocked = !isActive;

    if (!isActive) {
      acc.positions.clear();
      acc.pendingOrders?.clear();
    }

    console.log("[ENGINE_SYNC] status changed:", accountId, isActive);
  }

  /* ===========================
     NEW ACCOUNT
  ============================ */

  static async onAccountCreated(accountId) {
    console.log("[ENGINE_SYNC] new account:", accountId);
    await this.syncAccount(accountId);
  }

  static removeAccount(accountId) {
    const id = String(accountId || "");
    if (!id) return;

    const acc = tradeEngine.accounts.get(id);
    if (acc) {
      acc.positions?.clear?.();
      acc.pendingOrders?.clear?.();
    }

    tradeEngine.accounts.delete(id);
    console.log("[ENGINE_SYNC] account removed:", id);
  }

  /* ===========================
     DEPOSIT
  ============================ */

  static async onDeposit(accountId, amount) {
    const id = String(accountId);
    let acc = tradeEngine.accounts.get(id);

    if (!acc) {
      await this.syncAccount(id);
      // If the account wasn't in RAM, syncAccount() already loaded the latest DB snapshot.
      return;
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt === 0) return;

    acc.balance = Number(acc.balance + amt);
    acc.recalc();

    console.log("[ENGINE_SYNC] deposit:", id, amt);
  }

  /* ===========================
     WITHDRAW
  ============================ */

  static async onWithdraw(accountId, amount) {
    const id = String(accountId);
    let acc = tradeEngine.accounts.get(id);

    if (!acc) {
      await this.syncAccount(id);
      // If the account wasn't in RAM, syncAccount() already loaded the latest DB snapshot.
      return;
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt === 0) return;

    acc.balance = Number(acc.balance - amt);
    acc.recalc();

    console.log("[ENGINE_SYNC] withdraw:", id, amt);
  }

  /* ===========================
     INTERNAL TRANSFER
  ============================ */

  static async onInternalTransfer(fromId, toId, amount) {
    await this.onWithdraw(fromId, amount);
    await this.onDeposit(toId, amount);

    console.log(
      "[ENGINE_SYNC] transfer:",
      fromId,
      "->",
      toId,
      "amount:",
      amount
    );
  }

  /* ===========================
     FULL RELOAD (ADMIN / CRASH)
  ============================ */

  static async reloadAll() {
    tradeEngine.accounts.clear();

    const accounts = await AccountModel.find({
      status: "active",
    }).lean();

    for (const acc of accounts) {
      tradeEngine.loadAccount({
        accountId: String(acc._id),

        balance: Number(acc.balance),
        leverage: Number(acc.leverage),

        userId: String(acc.user_id),

        lastIp: acc.lastIp || null,

        commission_per_lot: Number(acc.commission_per_lot || 0),
        swap_charge: Number(acc.swap_charge || 0),

        spread_enabled: acc.spread_enabled === true,
        bonus_balance: Number(acc.bonus_balance || 0),
        bonus_percent_override:
          typeof acc.bonus_percent_override === "number"
            ? acc.bonus_percent_override
            : acc.bonus_percent_override === null
              ? null
              : undefined,
        brokerId: acc.brokerId != null ? String(acc.brokerId) : undefined,

        account_type: acc.account_type,
        status: acc.status,
      });
    }

    console.log("[ENGINE_SYNC] reload complete:", accounts.length);
  }

  /* ===========================
     INSTRUMENT / SYMBOL SYNC
  ============================ */

  static loadSymbolFromInstrument(instrument) {
    if (!instrument || !instrument.code) return;

    const code = String(instrument.code).toUpperCase();
    const isTradeable = instrument.isTradeable !== false;

    if (!isTradeable) {
      tradeEngine.symbols.delete(code);
      console.log("[ENGINE_SYNC] symbol removed (not tradeable):", code);
      return;
    }

    tradeEngine.loadSymbol(code, {
      // Segment is used for market schedule validation inside the engine.
      segment: instrument.segment ? String(instrument.segment).trim().toLowerCase() : undefined,
      contractSize: Number(instrument.contractSize) || 1,
      maxLeverage: Number(instrument.maxLeverage) || 2000,
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

    console.log("[ENGINE_SYNC] symbol synced:", code);
  }

  static async syncInstrumentById(instrumentId) {
    const instrument = await InstrumentModel.findById(instrumentId).lean();

    if (!instrument) {
      console.warn("[ENGINE_SYNC] instrument not found:", instrumentId);
      return;
    }

    this.loadSymbolFromInstrument(instrument);
  }

  static removeInstrumentByCode(codeRaw) {
    const code = String(codeRaw || "").trim().toUpperCase();
    if (!code) return;

    tradeEngine.symbols.delete(code);
    console.log("[ENGINE_SYNC] symbol removed:", code);
  }
}

export default EngineSync;
