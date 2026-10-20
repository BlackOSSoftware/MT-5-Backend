// src/trade-engine/Engine.js

import { v4 as uuidv4 } from "uuid";
import { validateOrder } from "./order.validator.js";
import { AccountState } from "./AccountState.js";
import { Position } from "./Position.js";
import { RiskManager } from "./RiskManager.js";
import { engineEvents } from "./EngineEvents.js";
import { ledgerQueue } from "./LedgerQueue.js";

const DEBUG_LIVE = true;

export class Engine {
  constructor() {
    this.accounts = new Map();
    this.symbols = new Map();
    this.bonusEnabled = true;
    this.bonusPercentDefault = 0;

    // In-process market status cache (ultra-fast, no Redis/DB on the order path).
    // Updated by `src/jobs/market.cron.js` and optionally after admin schedule updates.
    this.marketStatusBySegment = new Map(); // key: segment (lowercase) -> { isMarketOpen, reason, ... }
  }

  /* =========================
     BOOTSTRAP
  ========================== */

  setBonusSettings({ bonus_enabled, default_bonus_percent } = {}) {
    if (bonus_enabled !== undefined) {
      this.bonusEnabled = Boolean(bonus_enabled);
    }

    if (default_bonus_percent !== undefined) {
      const v = Number(default_bonus_percent);
      if (Number.isFinite(v) && v >= 0) {
        this.bonusPercentDefault = Math.min(v, 200);
      }
    }

    const effectiveDefault = this.bonusEnabled ? this.bonusPercentDefault : 0;

    for (const acc of this.accounts.values()) {
      const override =
        typeof acc.bonus_percent_override === "number"
          ? acc.bonus_percent_override
          : null;

      let effective =
        this.bonusEnabled && override !== null ? override : effectiveDefault;

      if (!Number.isFinite(effective) || effective < 0) effective = 0;

      acc.bonus_percent = effective;
      if (typeof acc.recalc === "function") acc.recalc();
    }
  }

  /**
   * loadAccount
   *
   * NOTE: accepts optional commission_per_lot, swap_charge and spread_enabled snapshots.
   * Callers that don't pass them will keep behaviour unchanged.
   */
  loadAccount({
    accountId,
    balance,
    leverage,
    userId,
    lastIp,
    commission_per_lot = 0,
    swap_charge = 0,
    spread_enabled = false,
    bonus_balance = undefined,
    bonus_percent_override = undefined,
    status = undefined,
    account_type = undefined,
  }) {
    const id = String(accountId);
    if (!id || id === "undefined" || id === "null") {
      throw new Error("Invalid accountId");
    }

    // IMPORTANT:
    // Do NOT replace an existing in-RAM account object, otherwise we lose positions/pendingOrders
    // and any websocket references (ws.engineAccount) become stale.
    const existing = this.accounts.get(id) || null;

    const overrideForCalc =
      bonus_percent_override !== undefined
        ? typeof bonus_percent_override === "number"
          ? bonus_percent_override
          : null
        : typeof existing?.bonus_percent_override === "number"
          ? existing.bonus_percent_override
          : null;

    const defaultPercent = this.bonusEnabled ? this.bonusPercentDefault : 0;
    let effectivePercent =
      this.bonusEnabled && overrideForCalc !== null
        ? overrideForCalc
        : defaultPercent;

    if (!Number.isFinite(effectivePercent) || effectivePercent < 0) {
      effectivePercent = 0;
    }
    if (effectivePercent > 200) effectivePercent = 200;

    const acc = existing
      ? existing
      : new AccountState({
          accountId: id,
          balance,
          leverage,
          userId,
          lastIp,
          bonus_balance: bonus_balance ?? 0,
          bonus_percent: effectivePercent,
          bonus_percent_override:
            typeof bonus_percent_override === "number"
              ? bonus_percent_override
              : bonus_percent_override === null
                ? null
                : null,
        });

    // base fields (preserve runtime state like positions/pendingOrders)
    if (balance !== undefined) acc.balance = Number(balance) || 0;
    if (leverage !== undefined) acc.leverage = Number(leverage) || 2000;
    if (userId !== undefined) acc.userId = String(userId);
    if (lastIp !== undefined) acc.lastIp = lastIp;

    // snapshot fields (safe to add directly)
    acc.commission_per_lot =
      typeof commission_per_lot === "number" ? commission_per_lot : 0;
    acc.swap_charge = typeof swap_charge === "number" ? swap_charge : 0;

    // per-account spread ON/OFF
    acc.spread_enabled = Boolean(spread_enabled);

    if (bonus_balance !== undefined) {
      acc.bonus_balance = Number(bonus_balance) || 0;
    }

    if (bonus_percent_override !== undefined) {
      acc.bonus_percent_override =
        typeof bonus_percent_override === "number"
          ? bonus_percent_override
          : bonus_percent_override === null
            ? null
            : null;
    }

    const overrideEffective =
      typeof acc.bonus_percent_override === "number"
        ? acc.bonus_percent_override
        : null;
    let nextPercent =
      this.bonusEnabled && overrideEffective !== null
        ? overrideEffective
        : this.bonusEnabled
          ? this.bonusPercentDefault
          : 0;

    if (!Number.isFinite(nextPercent) || nextPercent < 0) nextPercent = 0;
    if (nextPercent > 200) nextPercent = 200;
    acc.bonus_percent = nextPercent;

    if (status !== undefined) acc.status = String(status);
    if (account_type !== undefined) acc.account_type = String(account_type);

    // recalc equity/freeMargin after any balance change
    try {
      if (typeof acc.recalc === "function") acc.recalc();
    } catch {}

    if (!existing) {
      this.accounts.set(id, acc);
    }

    if (DEBUG_LIVE) {
      console.log("[ENGINE][ACCOUNT_LOADED]", {
        accountId: id,
        mode: existing ? "update" : "create",
        balance,
        leverage,
        userId,
        commission_per_lot: acc.commission_per_lot,
        swap_charge: acc.swap_charge,
        spread_enabled: acc.spread_enabled,
        bonus_balance: acc.bonus_balance,
        bonus_percent: acc.bonus_percent,
        status: acc.status,
        account_type: acc.account_type,
      });
    }
  }

  loadSymbol(symbol, config) {
    // config may contain: contractSize, maxLeverage, spread, tickSize, pricePrecision
    const safeContractSize = Number(config?.contractSize);
    const contractSize =
      Number.isFinite(safeContractSize) && safeContractSize > 0
        ? safeContractSize
        : 1;

    this.symbols.set(symbol, {
      ...config,
      contractSize,
      bid: 0,
      ask: 0,
      rawBid: 0,
      rawAsk: 0,
      lastTickAt: 0,
    });

    if (DEBUG_LIVE) {
      console.log("[ENGINE][SYMBOL_LOADED]", symbol, config);
    }
  }

  /* =========================
     MARKET STATUS (FAST CACHE)
     - enforced for MARKET orders
     - used to pause pending executions when market is closed
  ========================== */

  normalizeSegment(segmentRaw) {
    return String(segmentRaw || "").trim().toLowerCase();
  }

  setMarketStatus(segmentRaw, status) {
    const seg = this.normalizeSegment(segmentRaw);
    if (!seg || !status) return;

    // Keep the original payload but force normalized segment key.
    this.marketStatusBySegment.set(seg, { ...status, segment: seg });
  }

  getMarketStatus(segmentRaw) {
    const seg = this.normalizeSegment(segmentRaw);
    if (!seg) return null;
    return this.marketStatusBySegment.get(seg) || null;
  }

  getMarketStatusForSymbol(symbol) {
    const sym = this.symbols.get(symbol);
    if (!sym) return null;

    const seg = this.normalizeSegment(sym.segment);
    if (!seg) return null;

    return this.getMarketStatus(seg);
  }

  /* =========================
     PRICE / SPREAD / TICK UTIL
     - single source of truth for formatting prices
  ========================== */

  // Round a number to nearest tick safely
  roundToTick(value, tick, isBid) {
    if (!tick || tick <= 0) return value;
    // avoid floating precision issues by using integer math when possible
    const factor = 1 / tick;
    return isBid
      ? Math.floor(value * factor) / factor // bids down
      : Math.ceil(value * factor) / factor; // asks up
  }

  /**
   * formatPrice(account, sym, bid, ask)
   *
   * Returns { bid, ask } adjusted by:
   *  - account.spread_enabled (if true)
   *  - symbol spread (sym.spread)
   *  - rounding to sym.tickSize
   *  - fixed to sym.pricePrecision
   */
  formatPrice(account, sym, bid, ask) {
    let outBid = Number(bid);
    let outAsk = Number(ask);

    // apply spread only when account has it enabled
    if (
      account &&
      account.spread_enabled &&
      typeof sym.spread === "number" &&
      sym.spread > 0
    ) {
      const half = sym.spread / 2;
      const mode =
        typeof sym.spread_mode === "string"
          ? sym.spread_mode.trim().toUpperCase()
          : "ADD_ON";

      if (mode === "FIXED" && Number.isFinite(outBid) && Number.isFinite(outAsk)) {
        const mid = (outBid + outAsk) / 2;
        outBid = mid - half;
        outAsk = mid + half;
      } else {
        outBid = outBid - half;
        outAsk = outAsk + half;
      }
    }

    // tick rounding (bid down, ask up)
    if (typeof sym.tickSize === "number" && sym.tickSize > 0) {
      outBid = this.roundToTick(outBid, sym.tickSize, true);
      outAsk = this.roundToTick(outAsk, sym.tickSize, false);
    }

    // apply precision
    if (typeof sym.pricePrecision === "number") {
      outBid = Number(outBid.toFixed(sym.pricePrecision));
      outAsk = Number(outAsk.toFixed(sym.pricePrecision));
    }

    return { bid: outBid, ask: outAsk };
  }

  /* =========================
     RESTORE FROM DB
  ========================== */

  loadOpenPosition(trade) {
    const account = this.accounts.get(String(trade.accountId));
    if (!account) return;

    const sym = this.symbols.get(trade.symbol);
    const csRaw =
      sym && typeof sym.contractSize === "number"
        ? sym.contractSize
        : trade.contractSize;
    const contractSize =
      Number.isFinite(Number(csRaw)) && Number(csRaw) > 0 ? Number(csRaw) : 1;

    const position = new Position({
      positionId: trade.positionId,
      accountId: String(trade.accountId),
      symbol: trade.symbol,
      side: trade.side,
      volume: trade.volume,
      openPrice: trade.openPrice,
      contractSize,
      leverage: trade.leverage,
      stopLoss: trade.stopLoss,
      takeProfit: trade.takeProfit,
    });

    // restore open time from DB (Trade.openTime is a Date)
    try {
      const t = trade?.openTime;
      if (t) {
        const ts = t instanceof Date ? t.getTime() : new Date(t).getTime();
        if (Number.isFinite(ts) && ts > 0) position.openTime = ts;
      }
    } catch {}

    // restore commission/swap if present in DB object (optional)
    if (typeof trade.commission === "number") {
      position.commission = trade.commission;
    }
    if (typeof trade.swapPerDay === "number") {
      position.swapPerDay = trade.swapPerDay;
    }

    account.positions.set(position.positionId, position);
  }

  loadPendingOrder(order) {
    const account = this.accounts.get(String(order.accountId));
    if (!account) return;

    if (!account.pendingOrders) {
      account.pendingOrders = new Map();
    }

    account.pendingOrders.set(order.orderId, {
      orderId: order.orderId,
      userId: order.userId,
      accountId: String(order.accountId),
      symbol: order.symbol,
      side: order.side,
      orderType: order.orderType,
      price: order.price,
      volume: order.volume,
      stopLoss: order.stopLoss,
      takeProfit: order.takeProfit,
      expireType: order.expireType || "GTC",
      expireAt: order.expireAt ? new Date(order.expireAt).getTime() : null,
      createdAt: order.createdAt
        ? new Date(order.createdAt).getTime()
        : Date.now(),
    });

    try {
      engineEvents.emit("LIVE_PENDING", {
        accountId: String(order.accountId),
        orderId: order.orderId,
        symbol: order.symbol,
        side: order.side,
        orderType: order.orderType,
        price: Number(order.price),
        volume: Number(order.volume),
        stopLoss: order.stopLoss !== undefined ? order.stopLoss : null,
        takeProfit: order.takeProfit !== undefined ? order.takeProfit : null,
        expireType: order.expireType || "GTC",
        expireAt: order.expireAt ? new Date(order.expireAt).getTime() : null,
        createdAt: order.createdAt
          ? new Date(order.createdAt).getTime()
          : Date.now(),
        status: "PENDING",
      });
    } catch (err) {
      console.error("[ENGINE] emit LIVE_PENDING failed", err);
    }
  }

  /* =========================
     HEDGED MARGIN
  ========================== */

  recalcUsedMargin(account) {
    let totalMargin = 0;
    const buckets = new Map();

    for (const pos of account.positions.values()) {
      const sym = this.symbols.get(pos.symbol);
      const csRaw =
        sym && typeof sym.contractSize === "number"
          ? sym.contractSize
          : pos.contractSize;
      const contractSize =
        Number.isFinite(Number(csRaw)) && Number(csRaw) > 0
          ? Number(csRaw)
          : 1;

      if (!buckets.has(pos.symbol)) {
        buckets.set(pos.symbol, {
          buy: 0,
          sell: 0,
          buyNotional: 0,
          sellNotional: 0,
          contractSize,
          leverage: pos.leverage,
        });
      }

      const b = buckets.get(pos.symbol);
      const vol = Number(pos.volume) || 0;
      const openPrice = Number(pos.openPrice) || 0;

      if (pos.side === "BUY") {
        b.buy += vol;
        b.buyNotional += vol * openPrice;
      } else {
        b.sell += vol;
        b.sellNotional += vol * openPrice;
      }
    }

    for (const [symbol, b] of buckets.entries()) {
      const net = Math.abs(b.buy - b.sell);
      if (net <= 0) continue;

      let price = 0;
      if (b.buy > b.sell) {
        price = b.buy > 0 ? b.buyNotional / b.buy : 0;
      } else {
        price = b.sell > 0 ? b.sellNotional / b.sell : 0;
      }

      if (!Number.isFinite(price) || price <= 0) {
        const sym = this.symbols.get(symbol);
        if (sym) {
          price = b.buy > b.sell ? sym.ask : sym.bid;
        }
      }

      if (!Number.isFinite(price) || price <= 0) continue;

      totalMargin += (net * b.contractSize * price) / b.leverage;
    }

    account.usedMargin = totalMargin;
    account.recalc();
  }

  /* =========================
     MARKET ORDER
     - Added optional overrideOpenPrice to support pending->market transitions
     - Commission charged immediately (deducted from balance)
     - Swap computed and attached to position (not deducted)
  ========================== */

  placeMarketOrder({
    accountId,
    symbol,
    side,
    volume,
    stopLoss,
    takeProfit,
    overrideOpenPrice = null,
  }) {
    const account = this.accounts.get(accountId);
    const sym = this.symbols.get(symbol);

    if (!account) throw new Error("Invalid trading account");
    if (!sym) throw new Error("Invalid symbol");
    if (sym.bid <= 0 || sym.ask <= 0) throw new Error("Price not ready");

    // Market hours guard (fast: RAM status snapshot). This protects both user and admin trades.
    const status = this.getMarketStatusForSymbol(symbol);
    if (!status) {
      throw new Error("Market status unavailable, please try again");
    }
    if (status.isMarketOpen !== true) {
      throw new Error("Market is closed");
    }

    // Run validation for MARKET order (SL/TP vs current market)
    validateOrder({
      side,
      orderType: "MARKET",
      price: null,
      stopLoss,
      takeProfit,
      bid: sym.bid,
      ask: sym.ask,
    });

    // If overrideOpenPrice provided (e.g. for pending fill at its limit), prefer it
    // Otherwise compute per-account formatted price
    let openPrice;
    if (typeof overrideOpenPrice === "number") {
      openPrice = overrideOpenPrice;
    } else {
      const userPrice = this.formatPrice(account, sym, sym.bid, sym.ask);
      openPrice = side === "BUY" ? userPrice.ask : userPrice.bid;
    }

    const leverage = Math.min(account.leverage, sym.maxLeverage);

    const position = new Position({
      positionId: uuidv4(),
      accountId,
      symbol,
      side,
      volume,
      openPrice,
      contractSize: sym.contractSize,
      leverage,
      stopLoss,
      takeProfit,
    });

    // attach commission & swap info (computed below)
    position.commission = 0;
    position.swapPerDay = 0;

    account.positions.set(position.positionId, position);

    // recalc margin BEFORE final checks
    this.recalcUsedMargin(account);

    const freeMarginRaw =
      typeof account.freeMarginRaw === "number"
        ? account.freeMarginRaw
        : account.freeMargin;
    if (freeMarginRaw < 0) {
      // rollback
      account.positions.delete(position.positionId);
      this.recalcUsedMargin(account);
      throw new Error("Insufficient margin");
    }

    // ====== Spread snapshot (for ledger/brokerage) ======
    const appliedSpread =
      account &&
      account.spread_enabled &&
      typeof sym.spread === "number" &&
      sym.spread > 0
        ? sym.spread
        : 0;

    // ====== Commission calculation & immediate deduction ======
    // Commission is charged proportional to lots: commission_per_lot * volume
    const commissionPerLot =
      typeof account.commission_per_lot === "number"
        ? account.commission_per_lot
        : 0;
    const commissionCharged = Number(
      (commissionPerLot * position.volume).toFixed(8),
    ); // precision safe

    if (commissionCharged > 0) {
      // Ensure account has enough balance to pay commission
      if (account.balance < commissionCharged) {
        // rollback
        account.positions.delete(position.positionId);
        this.recalcUsedMargin(account);
        throw new Error("Insufficient funds for commission");
      }

      // Deduct commission now
      account.balance = Number(
        (account.balance - commissionCharged).toFixed(8),
      );
      position.commission = commissionCharged;

      // ledger entry for commission (immediate)
      ledgerQueue.enqueue("COMMISSION_CHARGE", {
        userId: account.userId,
        accountId,
        positionId: position.positionId,
        symbol,
        volume: position.volume,
        commission: commissionCharged,
        createdAt: Date.now(),
      });
    }

    // ====== Swap calculation (per day per lot) ======
    // Do NOT deduct here — cronjob will handle real deduction. We only compute & expose.
    // NOTE: In this system swap is always a DEBIT (never credit).
    // We enforce non-negative swap-per-lot here so the stored Trade.swap is always >= 0.
    const swapPerLotRaw =
      typeof account.swap_charge === "number" ? account.swap_charge : 0;
    const swapPerLot = Math.abs(Number(swapPerLotRaw) || 0);
    const swapPerDay = Number((swapPerLot * position.volume).toFixed(8));
    position.swapPerDay = swapPerDay;

    // Ledger: record trade open (successful)
    ledgerQueue.enqueue("TRADE_OPEN", {
      userId: account.userId,
      accountId,
      ipAddress: account.lastIp || "SYSTEM",
      positionId: position.positionId,
      symbol,
      side,
      orderType: "MARKET",
      volume,
      contractSize: sym.contractSize,
      leverage,
      openPrice,
      stopLoss,
      takeProfit,
      marginUsed: account.usedMargin,
      spread: appliedSpread,
      commissionCharged: position.commission,
      swapPerDay: position.swapPerDay,
      createdAt: Date.now(),
    });

    // Emit live updates so websocket can show the new position immediately
    try {
      engineEvents.emit("LIVE_POSITION", {
        accountId: account.accountId,
        positionId: position.positionId,
        volume: position.volume,
        openTime: position.openTime || Date.now(),
        symbol: position.symbol,
        side: position.side,
        openPrice: position.openPrice,
        currentPrice: position.openPrice,
        floatingPnL: 0,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
        commission: position.commission, // commission already charged
        swapPerDay: position.swapPerDay, // swap (info only)
      });
    } catch (err) {
      console.error("[ENGINE] emit LIVE_POSITION failed", err);
    }

    // Also emit account snapshot (balance may have changed due to commission)
    try {
      engineEvents.emit("LIVE_ACCOUNT", {
        accountId: account.accountId,
        balance: Number(account.balance.toFixed(2)),
        equity: Number(account.equity.toFixed(2)),
        bonusBalance: Number(
          account.bonus_balance?.toFixed
            ? account.bonus_balance.toFixed(2)
            : account.bonus_balance || 0,
        ),
        bonusLive: Number(
          account.bonus_live?.toFixed
            ? account.bonus_live.toFixed(2)
            : account.bonus_live || 0,
        ),
        bonusPercent: Number(
          account.bonus_percent?.toFixed
            ? account.bonus_percent.toFixed(2)
            : account.bonus_percent || 0,
        ),
        usedMargin: Number(account.usedMargin.toFixed(2)),
        freeMargin: Number(account.freeMargin.toFixed(2)),
      });
    } catch (err) {
      console.error("[ENGINE] emit LIVE_ACCOUNT failed", err);
    }

    return position;
  }

  /* =========================
     PLACE PENDING ORDER
  ========================== */

  placePendingOrder({
    userId,
    accountId,
    symbol,
    side,
    orderType,
    price,
    limitPrice,
    volume,
    stopLoss,
    takeProfit,
    expireType = "GTC",
    expireAt = null,
  }) {
    const account = this.accounts.get(accountId);
    const sym = this.symbols.get(symbol);

    if (!account) throw new Error("Invalid trading account");
    if (!sym) throw new Error("Invalid symbol");

    if (
      ![
        "BUY_LIMIT",
        "SELL_LIMIT",
        "BUY_STOP",
        "SELL_STOP",
        "BUY_STOP_LIMIT",
        "SELL_STOP_LIMIT",
      ].includes(orderType)
    ) {
      throw new Error("Invalid pending order type");
    }

    // run validation for pending order (using raw market prices for validation)
    validateOrder({
      side,
      orderType,
      price: Number(price),
      limitPrice: limitPrice !== undefined ? limitPrice : null,
      stopLoss: stopLoss !== undefined ? stopLoss : null,
      takeProfit: takeProfit !== undefined ? takeProfit : null,
      bid: sym.bid,
      ask: sym.ask,
    });

    if (!account.pendingOrders) {
      account.pendingOrders = new Map();
    }

    const orderId = uuidv4();

    const order = {
      orderId,
      userId,
      accountId,
      symbol,
      side,
      orderType,
      price: Number(price),
      limitPrice:
        limitPrice !== undefined && limitPrice !== null
          ? Number(limitPrice)
          : null,
      volume: Number(volume),
      stopLoss: stopLoss !== undefined ? stopLoss : null,
      takeProfit: takeProfit !== undefined ? takeProfit : null,
      expireType,
      expireAt: expireAt ? new Date(expireAt).getTime() : null,
      createdAt: Date.now(),
    };

    // Save in memory
    account.pendingOrders.set(orderId, order);

    // Save in DB / Ledger (create)
    ledgerQueue.enqueue("ORDER_PENDING_CREATE", order);

    // Emit LIVE_PENDING so clients see pending immediately (and treat as ongoing update)
    try {
      engineEvents.emit("LIVE_PENDING", {
        ...order,
        accountId: String(accountId),
        status: "PENDING",
      });
    } catch (err) {
      console.error(
        "[ENGINE] emit LIVE_PENDING failed (placePendingOrder)",
        err,
      );
    }

    return order;
  }

  /* =========================
     MODIFY PENDING ORDER
  ========================== */

  modifyPendingOrder({ accountId, orderId, price, stopLoss, takeProfit }) {
    const account = this.accounts.get(accountId);

    if (!account) throw new Error("Invalid account");
    if (!account.pendingOrders) throw new Error("No pending orders");

    const order = account.pendingOrders.get(orderId);

    if (!order) throw new Error("Pending order not found");

    // compute prospective new values (to validate)
    const newPrice = typeof price === "number" ? price : order.price;
    const newStop = typeof stopLoss === "number" ? stopLoss : order.stopLoss;
    const newTake =
      typeof takeProfit === "number" ? takeProfit : order.takeProfit;

    // get symbol config for validation
    const sym = this.symbols.get(order.symbol);
    if (!sym) throw new Error("Symbol not loaded");

    // Validate the modified order BEFORE applying (using raw market prices)
    validateOrder({
      side: order.side,
      orderType: order.orderType,
      price: Number(newPrice),
      limitPrice: order.limitPrice ?? null,
      stopLoss: newStop !== undefined ? newStop : null,
      takeProfit: newTake !== undefined ? newTake : null,
      bid: sym.bid,
      ask: sym.ask,
    });

    // Apply updates
    if (typeof price === "number") order.price = price;
    if (typeof stopLoss === "number") order.stopLoss = stopLoss;
    if (typeof takeProfit === "number") order.takeProfit = takeProfit;

    ledgerQueue.enqueue("ORDER_PENDING_MODIFY", order);

    // Emit updated snapshot for this pending order
    try {
      engineEvents.emit("LIVE_PENDING", {
        ...order,
        accountId: String(accountId),
        status: "PENDING_MODIFIED",
      });
    } catch (err) {
      console.error(
        "[ENGINE] emit LIVE_PENDING failed (modifyPendingOrder)",
        err,
      );
    }

    return order;
  }
  /* =========================
   MODIFY OPEN POSITION (SL / TP)
========================== */

  modifyPosition({ accountId, positionId, stopLoss, takeProfit }) {
    const account = this.accounts.get(accountId);

    if (!account) throw new Error("Invalid account");

    const pos = account.positions.get(positionId);

    if (!pos) throw new Error("Position not found");

    const sym = this.symbols.get(pos.symbol);

    if (!sym) throw new Error("Symbol not loaded");

    // current market (raw)
    const bid = sym.bid;
    const ask = sym.ask;

    // validate new SL/TP
    validateOrder({
      side: pos.side,
      orderType: "MARKET",
      price: null,
      stopLoss: typeof stopLoss === "number" ? stopLoss : pos.stopLoss,
      takeProfit: typeof takeProfit === "number" ? takeProfit : pos.takeProfit,
      bid,
      ask,
    });

    // apply updates
    if (typeof stopLoss === "number") {
      pos.stopLoss = stopLoss;
    }

    if (typeof takeProfit === "number") {
      pos.takeProfit = takeProfit;
    }

    // ledger
    ledgerQueue.enqueue("POSITION_MODIFY", {
      userId: account.userId,
      accountId,
      positionId,
      symbol: pos.symbol,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      updatedAt: Date.now(),
    });

    // emit update
    try {
      engineEvents.emit("LIVE_POSITION_MODIFY", {
        accountId,
        positionId,
        stopLoss: pos.stopLoss,
        takeProfit: pos.takeProfit,
      });
    } catch (err) {
      console.error("[ENGINE] emit LIVE_POSITION_MODIFY failed", err);
    }

    return {
      positionId,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
    };
  }

  /* =========================
     CANCEL PENDING ORDER
  ========================== */

  cancelPendingOrder({ accountId, orderId }) {
    const account = this.accounts.get(accountId);

    if (!account) throw new Error("Invalid account");
    if (!account.pendingOrders) throw new Error("No pending orders");

    const order = account.pendingOrders.get(orderId);

    if (!order) throw new Error("Pending order not found");

    account.pendingOrders.delete(orderId);

    ledgerQueue.enqueue("ORDER_PENDING_CANCEL", {
      orderId,
      reason: "MANUAL",
    });

    try {
      engineEvents.emit("LIVE_PENDING_CANCEL", {
        accountId,
        orderId,
      });
    } catch (err) {
      console.error("[ENGINE] emit LIVE_PENDING_CANCEL failed", err);
    }

    return true;
  }

  /* =========================
     PRICE TICK
     - On each tick we update symbol prices, emit live updates for matching
       pending orders (so WS sees them continuously), evaluate hits,
       execute safely (placeMarketOrder first, then ledger enqueue & emits)
  ========================== */

  async onTick(symbol, bid, ask) {
    const sym = this.symbols.get(symbol);
    if (!sym) return;

    // keep both raw and public fields
    sym.rawBid = bid;
    sym.rawAsk = ask;

    sym.bid = bid;
    sym.ask = ask;
    sym.lastTickAt = Date.now();

    // If market is closed for this symbol's segment, we keep pending orders pending (no execution),
    // but still emit live price updates so the UI remains responsive.
    const marketStatus = this.getMarketStatusForSymbol(symbol);
    const isMarketOpen = marketStatus?.isMarketOpen === true;

    for (const account of this.accounts.values()) {
      /* =====================
         PENDING ORDERS
      ====================== */

      if (account.pendingOrders?.size) {
        const now = Date.now();

        for (const order of Array.from(account.pendingOrders.values())) {
          /* ===== EXPIRE ===== */

          if (order.expireAt && now >= order.expireAt) {
            account.pendingOrders.delete(order.orderId);

            ledgerQueue.enqueue("ORDER_PENDING_CANCEL", {
              orderId: order.orderId,
              reason: "EXPIRED",
            });

            try {
              engineEvents.emit("LIVE_PENDING_CANCEL", {
                accountId: account.accountId,
                orderId: order.orderId,
                reason: "EXPIRED",
              });
            } catch (err) {
              console.error("[ENGINE] emit LIVE_PENDING_CANCEL failed", err);
            }

            continue;
          }

          /* ===== LIVE UPDATE ===== */

          if (order.symbol === symbol) {
            // compute per-account formatted price to show currentPrice
            let formattedPrice = { bid, ask };
            try {
              formattedPrice = this.formatPrice(account, sym, bid, ask);
            } catch (err) {
              formattedPrice = { bid, ask };
            }

            try {
              engineEvents.emit("LIVE_PENDING", {
                ...order,
                accountId: account.accountId,
                currentPrice:
                  order.side === "BUY"
                    ? formattedPrice.ask
                    : formattedPrice.bid,
                ageMs: Date.now() - (order.createdAt || Date.now()),
                status: "PENDING",
              });
            } catch (err) {
              console.error("[ENGINE] emit LIVE_PENDING failed", err);
            }
          }

          if (order.symbol !== symbol) continue;

          // Do not execute pending orders while market is closed.
          // Important: we DO NOT remove the order in this case (no false "failed" execution).
          if (!isMarketOpen) continue;

          /* ===== HIT CHECK ===== */
          // Use per-account formatted prices for hit checks when account has spread enabled,
          // otherwise raw market prices are fine.
          const priceForChecks =
            account && account.spread_enabled
              ? this.formatPrice(account, sym, bid, ask)
              : { bid, ask };

          /* ===== STOP_LIMIT -> LIMIT CONVERSION ===== */
          const stopLimitHit =
            (order.orderType === "BUY_STOP_LIMIT" &&
              priceForChecks.ask >= order.price) ||
            (order.orderType === "SELL_STOP_LIMIT" &&
              priceForChecks.bid <= order.price);

          if (stopLimitHit && order.limitPrice) {
            order.orderType =
              order.orderType === "BUY_STOP_LIMIT" ? "BUY_LIMIT" : "SELL_LIMIT";
            order.price = order.limitPrice;
            order.limitPrice = null;

            ledgerQueue.enqueue("ORDER_PENDING_MODIFY", order);

            try {
              engineEvents.emit("LIVE_PENDING", {
                ...order,
                accountId: String(order.accountId),
                status: "PENDING",
              });
            } catch (err) {
              console.error(
                "[ENGINE] emit LIVE_PENDING failed (stop-limit convert)",
                err,
              );
            }
            continue;
          }

          const hit =
            (order.orderType === "BUY_LIMIT" &&
              priceForChecks.ask <= order.price) ||
            (order.orderType === "SELL_LIMIT" &&
              priceForChecks.bid >= order.price) ||
            (order.orderType === "BUY_STOP" &&
              priceForChecks.ask >= order.price) ||
            (order.orderType === "SELL_STOP" &&
              priceForChecks.bid <= order.price);

          if (!hit) continue;

          /* ===== EXECUTE ===== */

          try {
            const position = this.placeMarketOrder({
              accountId: order.accountId,
              symbol: order.symbol,
              side: order.side,
              volume: order.volume,
              stopLoss: order.stopLoss,
              takeProfit: order.takeProfit,
              overrideOpenPrice: order.price,
            });

            // remove pending
            account.pendingOrders.delete(order.orderId);

            ledgerQueue.enqueue("ORDER_PENDING_EXECUTE", {
              ...order,
              executedAt: Date.now(),
              executedPositionId: position.positionId,
            });

            try {
              engineEvents.emit("LIVE_PENDING_EXECUTE", {
                accountId: account.accountId,
                orderId: order.orderId,
                symbol: order.symbol,
                side: order.side,
                orderType: order.orderType,
                price: order.price,
                volume: order.volume,
                stopLoss: order.stopLoss,
                takeProfit: order.takeProfit,
                createdAt: order.createdAt,
                executedAt: Date.now(),
                positionId: position.positionId,
              });
            } catch (err) {
              console.error("[ENGINE] emit LIVE_PENDING_EXECUTE failed", err);
            }

            try {
              engineEvents.emit("ORDER_EXECUTED", {
                accountId: account.accountId,
                orderId: order.orderId,
                positionId: position.positionId,
              });
            } catch (err) {
              console.error("[ENGINE] emit ORDER_EXECUTED failed", err);
            }
          } catch (err) {
            /* ===== EXECUTE FAILED ===== */

            const reason =
              err && err.message ? err.message : "EXECUTION_FAILED";

            console.error("[ENGINE] Pending execution failed", {
              orderId: order.orderId,
              accountId: account.accountId,
              userId: order.userId,
              symbol: order.symbol,
              side: order.side,
              type: order.orderType,
              price: order.price,
              volume: order.volume,
              balance: account.balance,
              equity: account.equity,
              freeMargin: account.freeMargin,
              usedMargin: account.usedMargin,
              reason,
            });

            // remove failed order (no retry loop)
            if (account.pendingOrders instanceof Map) {
              account.pendingOrders.delete(order.orderId);
            }

            ledgerQueue.enqueue("ORDER_PENDING_EXECUTE_FAILED", {
              orderId: order.orderId,
              accountId: account.accountId,
              symbol: order.symbol,
              reason,
            });

            try {
              engineEvents.emit("LIVE_PENDING_EXECUTE_FAILED", {
                accountId: account.accountId,
                orderId: order.orderId,
                symbol: order.symbol,
                reason,
              });
            } catch (emitErr) {
              console.error(
                "[ENGINE] emit LIVE_PENDING_EXECUTE_FAILED failed",
                emitErr,
              );
            }
          }
        }
      }

      /* =====================
         POSITIONS
      ====================== */

      for (const pos of account.positions.values()) {
        if (pos.symbol !== symbol) continue;

        // compute per-account formatted price for PnL and checks
        let formatted = { bid, ask };
        try {
          formatted = this.formatPrice(account, sym, bid, ask);
        } catch (err) {
          formatted = { bid, ask };
        }

        pos.updatePnL(formatted.bid, formatted.ask, sym?.contractSize);

        const currentPrice = pos.side === "BUY" ? formatted.bid : formatted.ask;

        try {
          engineEvents.emit("LIVE_POSITION", {
            accountId: account.accountId,
            positionId: pos.positionId,
            volume: pos.volume,
            openTime: pos.openTime,
            symbol: pos.symbol,
            side: pos.side,
            openPrice: pos.openPrice,
            currentPrice,
            floatingPnL: Number(pos.floatingPnL.toFixed(2)),
            contractSize: pos.contractSize ?? sym?.contractSize ?? null,
            stopLoss: pos.stopLoss,
            takeProfit: pos.takeProfit,
            commission: pos.commission || 0,
            swapPerDay: pos.swapPerDay || 0,
          });
        } catch (err) {
          console.error("[ENGINE] emit LIVE_POSITION failed", err);
        }

        // Do not close positions via SL/TP when the market is closed.
        if (isMarketOpen) {
          /* === STOP LOSS === */

          if (
            pos.stopLoss !== null &&
            ((pos.side === "BUY" && currentPrice <= pos.stopLoss) ||
              (pos.side === "SELL" && currentPrice >= pos.stopLoss))
          ) {
            this.closePositionInternal(account, pos, "STOP_LOSS", sym);
            continue;
          }

          /* === TAKE PROFIT === */

          if (
            pos.takeProfit !== null &&
            ((pos.side === "BUY" && currentPrice >= pos.takeProfit) ||
              (pos.side === "SELL" && currentPrice <= pos.takeProfit))
          ) {
            this.closePositionInternal(account, pos, "TAKE_PROFIT", sym);
          }
        }
      }

      /* =====================
         ACCOUNT UPDATE
      ====================== */

      this.recalcUsedMargin(account);

      try {
        engineEvents.emit("LIVE_ACCOUNT", {
          accountId: account.accountId,
          balance: Number(account.balance.toFixed(2)),
          equity: Number(account.equity.toFixed(2)),
          bonusBalance: Number(
            account.bonus_balance?.toFixed
              ? account.bonus_balance.toFixed(2)
              : account.bonus_balance || 0,
          ),
          bonusLive: Number(
            account.bonus_live?.toFixed
              ? account.bonus_live.toFixed(2)
              : account.bonus_live || 0,
          ),
          bonusPercent: Number(
            account.bonus_percent?.toFixed
              ? account.bonus_percent.toFixed(2)
              : account.bonus_percent || 0,
          ),
          usedMargin: Number(account.usedMargin.toFixed(2)),
          freeMargin: Number(account.freeMargin.toFixed(2)),
        });
      } catch (err) {
        console.error("[ENGINE] emit LIVE_ACCOUNT failed", err);
      }

      /* =====================
         RISK MANAGEMENT
      ====================== */

      // Prevent risk-driven closures (stopout) while the market is closed for this symbol.
      if (isMarketOpen) {
        await RiskManager.checkWarning(account);

        if (RiskManager.shouldStopOut(account)) {
          this.forceCloseAll(account);
        }
      }
    }
  }

  /* =========================
     CLOSE
  ========================== */

  closePositionInternal(account, pos, reason, sym) {
    // use per-account formatted prices for PnL and close price
    let formatted = { bid: sym.bid, ask: sym.ask };
    try {
      formatted = this.formatPrice(account, sym, sym.bid, sym.ask);
    } catch (err) {
      formatted = { bid: sym.bid, ask: sym.ask };
    }

    pos.updatePnL(formatted.bid, formatted.ask, sym?.contractSize);
    const realBalanceBeforeClose = Number(account.balance) || 0;
    const bonusBalanceBeforeClose = Number(account.bonus_balance) || 0;

    account.positions.delete(pos.positionId);

    // Full-loss accounts should floor at zero, never show a negative cash balance.
    account.balance = Number(
      Math.max(0, realBalanceBeforeClose + pos.floatingPnL).toFixed(8),
    );

    let bonusDeduct = 0;
    const realBalanceExhaustedByLoss =
      pos.floatingPnL < 0 && account.balance <= 0;
    if (realBalanceExhaustedByLoss && bonusBalanceBeforeClose > 0) {
      // A trading loss that exhausts the real balance also exhausts the
      // remaining promotional credit. This prevents old credit from becoming
      // usable again after a later deposit.
      bonusDeduct = bonusBalanceBeforeClose;
      account.bonus_balance = 0;
    } else if (pos.floatingPnL < 0) {
      const overflowLoss = Math.max(0, Math.abs(pos.floatingPnL) - realBalanceBeforeClose);
      if (overflowLoss > 0 && bonusBalanceBeforeClose > 0) {
        bonusDeduct = Math.min(bonusBalanceBeforeClose, overflowLoss);
        account.bonus_balance = Number(
          Math.max(0, bonusBalanceBeforeClose - bonusDeduct).toFixed(8),
        );
      }
    }

    // recalc after balance change
    this.recalcUsedMargin(account);

    ledgerQueue.enqueue("TRADE_CLOSE", {
      userId: account.userId,
      accountId: account.accountId,
      positionId: pos.positionId,
      closePrice: pos.side === "BUY" ? formatted.bid : formatted.ask,
      realizedPnL: Number(pos.floatingPnL.toFixed(2)),
      reason,
      commissionCharged: pos.commission || 0,
      swapPerDay: pos.swapPerDay || 0,
      bonusDeduct,
      bonusBalance: account.bonus_balance,
      realBalanceExhaustedByLoss,
      bonusPercent: Number(account.bonus_percent) || 0,
      closedAt: Date.now(),
    });

    // Emit account & position removal (position removed so send minimal info)
    try {
      engineEvents.emit("LIVE_POSITION_CLOSED", {
        accountId: account.accountId,
        positionId: pos.positionId,
        realizedPnL: Number(pos.floatingPnL.toFixed(2)),
        reason,
        commission: pos.commission || 0,
        swapPerDay: pos.swapPerDay || 0,
      });
    } catch (err) {
      console.error("[ENGINE] emit LIVE_POSITION_CLOSED failed", err);
    }

    try {
      engineEvents.emit("LIVE_ACCOUNT", {
        accountId: account.accountId,
        balance: Number(account.balance.toFixed(2)),
        equity: Number(account.equity.toFixed(2)),
        bonusBalance: Number(
          account.bonus_balance?.toFixed
            ? account.bonus_balance.toFixed(2)
            : account.bonus_balance || 0,
        ),
        bonusLive: Number(
          account.bonus_live?.toFixed
            ? account.bonus_live.toFixed(2)
            : account.bonus_live || 0,
        ),
        bonusPercent: Number(
          account.bonus_percent?.toFixed
            ? account.bonus_percent.toFixed(2)
            : account.bonus_percent || 0,
        ),
        usedMargin: Number(account.usedMargin.toFixed(2)),
        freeMargin: Number(account.freeMargin.toFixed(2)),
      });
    } catch (err) {
      console.error("[ENGINE] emit LIVE_ACCOUNT failed (closePosition)", err);
    }
  }

  forceCloseWorst(account) {
    let worst = null;

    for (const pos of account.positions.values()) {
      if (!worst || pos.floatingPnL < worst.floatingPnL) {
        worst = pos;
      }
    }

    if (!worst) return;

    const sym = this.symbols.get(worst.symbol);

    this.closePositionInternal(account, worst, "STOP_OUT", sym);
  }

  forceCloseAll(account) {
    const allPositions = Array.from(account.positions.values());
    if (allPositions.length === 0) return;

    for (const pos of allPositions) {
      const sym = this.symbols.get(pos.symbol);
      if (!sym) continue;
      this.closePositionInternal(account, pos, "STOP_OUT", sym);
    }
  }

  squareOffPosition({ accountId, positionId, reason = "MANUAL" }) {
    const account = this.accounts.get(accountId);

    if (!account) throw new Error("Account not found");

    const pos = account.positions.get(positionId);

    if (!pos) throw new Error("Position not found");

    const sym = this.symbols.get(pos.symbol);

    if (!sym) throw new Error("Symbol not loaded");

    const status = this.getMarketStatusForSymbol(pos.symbol);
    if (!status) {
      throw new Error("Market status unavailable, please try again");
    }
    if (status.isMarketOpen !== true) {
      throw new Error("Market is closed");
    }

    this.closePositionInternal(account, pos, reason, sym);

    return {
      positionId,
      realizedPnL: Number(pos.floatingPnL.toFixed(2)),
    };
  }
}
