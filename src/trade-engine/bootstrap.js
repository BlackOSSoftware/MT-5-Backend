// src/trade-engine/bootstrap.js

import { Engine } from "./Engine.js";

import Trade from "../models/Trade.model.js";
import PendingOrder from "../models/PendingOrder.model.js";
import {
  nextDealTicket,
  nextOrderTicket,
} from "../services/orderTicket.service.js";

export const tradeEngine = new Engine();

async function backfillField(Model, field, filter, nextTicket) {
  const query = { ...filter, [field]: { $exists: false } };
  const total = await Model.countDocuments(query);
  if (!total) return;

  console.log(`[BACKFILL] ${Model.modelName}.${field}: ${total} rows`);
  const cursor = Model.find(query).select("_id").lean().cursor();
  const batch = [];
  let done = 0;

  for await (const record of cursor) {
    const ticket = await nextTicket();
    batch.push({
      updateOne: {
        filter: { _id: record._id, [field]: { $exists: false } },
        update: { $set: { [field]: ticket } },
      },
    });

    if (batch.length >= 100) {
      await Model.bulkWrite(batch, { ordered: false });
      done += batch.length;
      batch.length = 0;
      if (done % 500 === 0 || done === total) {
        console.log(`[BACKFILL] ${Model.modelName}.${field}: ${done}/${total}`);
      }
    }
  }

  if (batch.length) {
    await Model.bulkWrite(batch, { ordered: false });
    done += batch.length;
  }
  console.log(`[BACKFILL] ${Model.modelName}.${field}: done (${done})`);
}

async function backfillOrderTickets() {
  if (String(process.env.SKIP_TICKET_BACKFILL || "").toLowerCase() === "true") {
    console.log("[BACKFILL] skipped (SKIP_TICKET_BACKFILL=true)");
    return;
  }

  await backfillField(Trade, "ticket", {}, nextOrderTicket);
  await backfillField(PendingOrder, "ticket", {}, nextOrderTicket);
  // Purane band trades: close order + in/out deals ke unique numbers.
  await backfillField(
    Trade,
    "closeTicket",
    { status: "CLOSED" },
    nextOrderTicket,
  );
  await backfillField(Trade, "openDealTicket", {}, nextDealTicket);
  await backfillField(
    Trade,
    "closeDealTicket",
    { status: "CLOSED" },
    nextDealTicket,
  );
}

export async function bootstrapEngine({ accounts, symbols }) {
  await backfillOrderTickets();
  /* =========================
     LOAD ACCOUNTS
  ========================= */

  for (const acc of accounts) {
    tradeEngine.loadAccount({
      accountId: String(acc._id),
      balance: acc.balance,
      leverage: acc.leverage,
      userId: acc.user_id != null ? String(acc.user_id) : undefined,
      lastIp: acc.lastIp || "SYSTEM",

      // charges
      commission_per_lot: Number(acc.commission_per_lot) || 0,
      swap_charge: Number(acc.swap_charge) || 0,

      // spread control (account-level ON / OFF)
      spread_enabled: Boolean(acc.spread_enabled),

      bonus_balance: Number(acc.bonus_balance || 0),
      bonus_percent_override:
        typeof acc.bonus_percent_override === "number"
          ? acc.bonus_percent_override
          : acc.bonus_percent_override === null
            ? null
            : undefined,
      brokerId: acc.brokerId != null ? String(acc.brokerId) : undefined,
    });
  }

  /* =========================
     LOAD SYMBOLS
  ========================= */

  for (const sym of symbols) {
    tradeEngine.loadSymbol(sym.code, {
      // Segment is used for market open/close checks (forex/crypto/metal etc).
      // Normalize to lowercase to match MarketSchedule segment keys.
      segment: sym.segment ? String(sym.segment).trim().toLowerCase() : undefined,
      contractSize: sym.contractSize,
      maxLeverage: sym.maxLeverage || 2000,

      // pricing rules (from Instrument)
      spread: Number(sym.spread) || 0,
      spread_mode:
        typeof sym.spread_mode === "string"
          ? sym.spread_mode.trim().toUpperCase()
          : "ADD_ON",
      tickSize: Number(sym.tickSize) || 0,
      pricePrecision:
        typeof sym.pricePrecision === "number"
          ? sym.pricePrecision
          : undefined,
    });
  }

  /* =========================
     RESTORE OPEN TRADES
  ========================= */

  const openTrades = await Trade.find({
    status: "OPEN",
  }).lean();

  console.log("[BOOTSTRAP] Open trades:", openTrades.length);

  for (const trade of openTrades) {
    tradeEngine.loadOpenPosition(trade);
  }

  /* =========================
     RESTORE PENDING ORDERS
  ========================= */

  const pendingOrders = await PendingOrder.find({
    status: "PENDING",
  }).lean();

  console.log("[BOOTSTRAP] Pending orders:", pendingOrders.length);

  for (const order of pendingOrders) {
    tradeEngine.loadPendingOrder(order);
  }

  /* =========================
     RECALCULATE MARGIN
  ========================= */

  for (const account of tradeEngine.accounts.values()) {
    tradeEngine.recalcUsedMargin(account);
  }

  console.log("[BOOTSTRAP] Engine fully restored");

  return tradeEngine;
}
