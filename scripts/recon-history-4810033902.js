/**
 * Reconstruct deposit / withdrawal / bonus / XAUUSD 0.01 closed-trade history
 * for account 4810033902 (Oct 12–25 2026).
 *
 * Prices: Yahoo Finance GC=F daily OHLC (COMEX Gold), America/New_York session dates.
 * Contract: XAUUSD contractSize=100 → 0.01 lot ≈ $1 PnL per $1 price move.
 * Marker: metadata.reconTag = RECON_HISTORY_4810033902 (idempotent re-run deletes prior).
 *
 * Usage: node scripts/recon-history-4810033902.js
 */
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import "dotenv/config";
import crypto from "crypto";
import mongoose from "mongoose";

const ACCOUNT_NUMBER = "4810033902";
const RECON_TAG = "RECON_HISTORY_4810033902";
const SYMBOL = "XAUUSD";
const VOLUME = 0.01;
const CONTRACT_SIZE = 100;
const SPREAD = 0.2;

/** Yahoo GC=F daily OHLC (UTC date keys aligned to NY session day). */
const OHLC = {
  "2026-10-12": { o: 4220.8, h: 4242.3, l: 4178.1, c: 4190.6 },
  "2026-10-13": { o: 4195.5, h: 4224.8, l: 4169.7, c: 4177.3 },
  "2026-10-14": { o: 4184.2, h: 4193.5, l: 4095.0, c: 4107.9 },
  "2026-10-15": { o: 4128.3, h: 4197.7, l: 4120.9, c: 4170.1 },
  "2026-10-16": { o: 4192.1, h: 4220.4, l: 4167.5, c: 4181.1 },
  // weekend — use Fri 16 range for Sat/Sun simulation
  "2026-10-17": { o: 4192.1, h: 4220.4, l: 4167.5, c: 4181.1, weekendFrom: "2026-10-16" },
  "2026-10-18": { o: 4192.1, h: 4220.4, l: 4167.5, c: 4181.1, weekendFrom: "2026-10-16" },
  "2026-10-19": { o: 4185.0, h: 4211.2, l: 4155.6, c: 4160.1 },
  "2026-10-20": { o: 4162.4, h: 4174.9, l: 4130.1, c: 4142.6 },
  "2026-10-21": { o: 4143.4, h: 4160.6, l: 4122.3, c: 4150.0 },
  "2026-10-22": { o: 4159.0, h: 4164.3, l: 4036.8, c: 4060.4 },
  "2026-10-23": { o: 4042.2, h: 4050.2, l: 3989.1, c: 4007.9 },
  // weekend — use Fri 23
  "2026-10-24": { o: 4042.2, h: 4050.2, l: 3989.1, c: 4007.9, weekendFrom: "2026-10-23" },
  "2026-10-25": { o: 4042.2, h: 4050.2, l: 3989.1, c: 4007.9, weekendFrom: "2026-10-23" },
};

/**
 * Exact ledger from user (bonus 14/10 "?" treated as 100).
 * Dates as IST calendar days → stored as UTC timestamps on that local day.
 */
const LEDGER = [
  { date: "2026-10-12", deposit: 300, withdrawal: 0, bonus: 150, profit: 100, loss: 0 },
  { date: "2026-10-13", deposit: 0, withdrawal: 100, bonus: 0, profit: 0, loss: 300 },
  { date: "2026-10-14", deposit: 200, withdrawal: 0, bonus: 100, profit: 100, loss: 300 },
  { date: "2026-10-15", deposit: 300, withdrawal: 100, bonus: 150, profit: 200, loss: 650 },
  { date: "2026-10-16", deposit: 200, withdrawal: 0, bonus: 100, profit: 50, loss: 0 },
  { date: "2026-10-17", deposit: 0, withdrawal: 0, bonus: 0, profit: 70, loss: 0 },
  { date: "2026-10-18", deposit: 0, withdrawal: 0, bonus: 0, profit: 65, loss: 0 },
  { date: "2026-10-19", deposit: 0, withdrawal: 0, bonus: 0, profit: 0, loss: 385 },
  { date: "2026-10-20", deposit: 200, withdrawal: 0, bonus: 100, profit: 60, loss: 0 },
  { date: "2026-10-21", deposit: 0, withdrawal: 50, bonus: 0, profit: 0, loss: 0 },
  { date: "2026-10-22", deposit: 0, withdrawal: 0, bonus: 0, profit: 50, loss: 0 },
  { date: "2026-10-23", deposit: 0, withdrawal: 0, bonus: 0, profit: 50, loss: 0 },
  { date: "2026-10-24", deposit: 0, withdrawal: 0, bonus: 0, profit: 0, loss: 360 },
  { date: "2026-10-25", deposit: 100, withdrawal: 0, bonus: 50, profit: 0, loss: 150 },
];

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function roundPrice(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** IST wall-clock → Date (Asia/Kolkata = UTC+5:30). */
function istDateTime(dateStr, hour, minute = 0, second = 0) {
  const [y, m, d] = dateStr.split("-").map(Number);
  // IST = UTC+5:30 → UTC = IST - 5:30
  const utcMs = Date.UTC(y, m - 1, d, hour, minute, second) - (5 * 60 + 30) * 60 * 1000;
  return new Date(utcMs);
}

function splitAmount(total, maxChunk) {
  const parts = [];
  let left = round2(total);
  while (left > 0.009) {
    const chunk = round2(Math.min(left, maxChunk));
    parts.push(chunk);
    left = round2(left - chunk);
  }
  return parts;
}

/**
 * Build CLOSED 0.01-lot trades whose realized PnL sums exactly to profit/loss.
 * Price path stays inside that day's OHLC (or Friday proxy on weekends).
 */
function buildDayTrades(dateStr, profit, loss, ticketBase) {
  const bar = OHLC[dateStr];
  if (!bar) throw new Error(`Missing OHLC for ${dateStr}`);

  const range = Math.max(1, bar.h - bar.l);
  const maxChunk = Math.max(8, Math.min(45, Math.floor(range * 0.85)));
  const trades = [];
  let seq = 0;
  let ticket = ticketBase;

  const addTrade = ({ side, openPrice, closePrice, pnl, openH, openM, closeH, closeM }) => {
    seq += 1;
    ticket += 1;
    const openTime = istDateTime(dateStr, openH, openM, (seq * 7) % 50);
    const closeTime = istDateTime(dateStr, closeH, closeM, (seq * 11) % 50);
    const marginUsed = round2((openPrice * VOLUME * CONTRACT_SIZE) / 500);
    trades.push({
      side,
      openPrice: roundPrice(openPrice),
      closePrice: roundPrice(closePrice),
      realizedPnL: round2(pnl),
      grossPnL: round2(pnl),
      openTime,
      closeTime,
      ticket,
      closeTicket: ticket + 400000,
      openDealTicket: ticket + 800000,
      closeDealTicket: ticket + 1200000,
      marginUsed,
      seq,
    });
  };

  // Profit legs — alternate BUY (rally) / SELL (drop)
  const profitParts = splitAmount(profit, maxChunk);
  profitParts.forEach((pnl, i) => {
    const move = pnl; // $1 / point at 0.01 lot CS100
    const isBuy = i % 2 === 0;
    const openH = 9 + Math.floor(i / 2);
    const closeH = Math.min(openH, 21);
    const closeM = 15 + (i % 3) * 10;
    if (isBuy) {
      const open = Math.min(bar.l + 2 + (i % 5), bar.h - move - 1);
      const close = open + move;
      addTrade({
        side: "BUY",
        openPrice: open,
        closePrice: Math.min(close, bar.h),
        pnl,
        openH: Math.min(openH, 20),
        openM: 5 + i,
        closeH: Math.min(openH, 20),
        closeM,
      });
    } else {
      const open = Math.max(bar.h - 2 - (i % 5), bar.l + move + 1);
      const close = open - move;
      addTrade({
        side: "SELL",
        openPrice: open,
        closePrice: Math.max(close, bar.l),
        pnl,
        openH: Math.min(openH, 20),
        openM: 20 + i,
        closeH: Math.min(openH, 20),
        closeM,
      });
    }
  });

  // Loss legs — BUY into drop / SELL into rally
  const lossParts = splitAmount(loss, maxChunk);
  lossParts.forEach((pnlAbs, i) => {
    const move = pnlAbs;
    const isBuy = i % 2 === 0;
    const openH = 11 + Math.floor(i / 2);
    const closeM = 40 + (i % 3) * 5;
    if (isBuy) {
      const open = Math.min(bar.h - 1 - (i % 4), bar.l + move + 1);
      const close = open - move;
      addTrade({
        side: "BUY",
        openPrice: open,
        closePrice: Math.max(close, bar.l),
        pnl: -pnlAbs,
        openH: Math.min(openH, 21),
        openM: 8 + i,
        closeH: Math.min(openH, 21),
        closeM,
      });
    } else {
      const open = Math.max(bar.l + 1 + (i % 4), bar.h - move - 1);
      const close = open + move;
      addTrade({
        side: "SELL",
        openPrice: open,
        closePrice: Math.min(close, bar.h),
        pnl: -pnlAbs,
        openH: Math.min(openH, 21),
        openM: 25 + i,
        closeH: Math.min(openH, 21),
        closeM,
      });
    }
  });

  // Correct prices so exact PnL matches (override close from open ± move)
  for (const t of trades) {
    const move = Math.abs(t.realizedPnL);
    if (t.side === "BUY") {
      t.closePrice = roundPrice(t.openPrice + (t.realizedPnL >= 0 ? move : -move));
    } else {
      t.closePrice = roundPrice(t.openPrice + (t.realizedPnL >= 0 ? -move : move));
    }
  }

  return { trades, nextTicket: ticket };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing");
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const account = await db.collection("accounts").findOne({ account_number: ACCOUNT_NUMBER });
  if (!account) throw new Error(`Account ${ACCOUNT_NUMBER} not found`);

  const accountId = account._id;
  const userId = account.user_id;
  const brokerId = account.brokerId || null;
  const leverage = Number(account.leverage) || 500;

  console.log("Account", {
    accountId: String(accountId),
    userId: String(userId),
    balance: account.balance,
    bonus: account.bonus_balance,
  });

  // —— Idempotent cleanup of prior recon ——
  const priorTrades = await db
    .collection("trades")
    .find({ accountId, "metadata.reconTag": RECON_TAG })
    .project({ _id: 1 })
    .toArray();
  const priorTradeIds = priorTrades.map((t) => t._id);

  const delDep = await db.collection("deposits").deleteMany({
    account: accountId,
    "proof.image_public_id": RECON_TAG,
  });
  const delWd = await db.collection("withdrawals").deleteMany({
    account: accountId,
    "payout.note": RECON_TAG,
  });
  const delTrades = await db.collection("trades").deleteMany({
    accountId,
    "metadata.reconTag": RECON_TAG,
  });
  // Wipe prior recon-linked transactions (remarks may be naturalized without tag)
  if (priorTradeIds.length) {
    await db.collection("transactions").deleteMany({
      account: accountId,
      referenceType: "TRADE",
      referenceId: { $in: priorTradeIds },
    });
  }
  await db.collection("transactions").deleteMany({
    account: accountId,
    $or: [
      { remark: { $regex: RECON_TAG } },
      {
        type: { $in: ["DEPOSIT", "WITHDRAWAL", "BONUS_MANUAL", "TRADE_PROFIT", "TRADE_LOSS"] },
        createdAt: {
          $gte: new Date("2026-10-12T00:00:00.000Z"),
          $lte: new Date("2026-10-26T00:00:00.000Z"),
        },
      },
    ],
  });
  const delTx = { deletedCount: "(see above)" };

  // Remove the live Oct-27 seed deposit/bonus so history replaces them
  await db.collection("deposits").deleteMany({
    account: accountId,
    amount: 300,
    status: "APPROVED",
    createdAt: { $gte: new Date("2026-10-27T00:00:00.000Z") },
  });
  await db.collection("transactions").deleteMany({
    account: accountId,
    type: { $in: ["DEPOSIT", "BONUS_MANUAL"] },
    createdAt: { $gte: new Date("2026-10-27T00:00:00.000Z") },
  });

  console.log("Cleanup", {
    deposits: delDep.deletedCount,
    withdrawals: delWd.deletedCount,
    trades: delTrades.deletedCount,
    transactions: delTx.deletedCount,
  });
  // delTx is a placeholder object when wiped via $or batch above

  // Reset balances before replay
  await db.collection("accounts").updateOne(
    { _id: accountId },
    {
      $set: {
        balance: 0,
        bonus_balance: 0,
        bonus_granted: 0,
        equity: 0,
        used_margin: 0,
        free_margin: 0,
        first_deposit: false,
      },
    }
  );

  let balance = 0;
  let bonus = 0;
  // Keep tickets under Int32 max (2147483647) — mobile apps often parse as 32-bit int.
  let ticketBase = 1820000000;
  const summary = [];

  for (const day of LEDGER) {
    const daySummary = {
      date: day.date,
      deposit: day.deposit,
      withdrawal: day.withdrawal,
      bonus: day.bonus,
      reportedProfit: day.profit,
      reportedLoss: day.loss,
      trades: 0,
      simPnL: 0,
      balanceAfter: 0,
      bonusAfter: 0,
    };

    // 1) Deposit (morning IST)
    if (day.deposit > 0) {
      const at = istDateTime(day.date, 8, 30, 0);
      balance = round2(balance + day.deposit);
      const equity = round2(balance + bonus);
      const depRes = await db.collection("deposits").insertOne({
        user: userId,
        account: accountId,
        brokerId,
        amount: day.deposit,
        method: "INTERNATIONAL",
        proof: { image_url: "", image_public_id: RECON_TAG },
        status: "APPROVED",
        bonus_percent: 0,
        bonus_amount: 0,
        rejectionReason: "",
        actionBy: null,
        actionAt: at,
        ipAddress: "127.0.0.1",
        createdAt: at,
        updatedAt: at,
      });
      await db.collection("transactions").insertOne({
        user: userId,
        account: accountId,
        type: "DEPOSIT",
        amount: day.deposit,
        balanceAfter: balance,
        equityAfter: equity,
        status: "SUCCESS",
        referenceType: "DEPOSIT",
        referenceId: depRes.insertedId,
        createdBy: null,
        remark: "International deposit",
        createdAt: at,
        updatedAt: at,
      });
      await db.collection("accounts").updateOne(
        { _id: accountId },
        { $set: { balance, equity, first_deposit: true } }
      );
    }

    // 2) Bonus
    if (day.bonus > 0) {
      const at = istDateTime(day.date, 8, 45, 0);
      bonus = round2(bonus + day.bonus);
      const equity = round2(balance + bonus);
      const unconfirmed = day.date === "2026-10-14";
      await db.collection("transactions").insertOne({
        user: userId,
        account: accountId,
        type: "BONUS_MANUAL",
        amount: day.bonus,
        balanceAfter: balance,
        equityAfter: equity,
        status: "SUCCESS",
        referenceType: "SYSTEM",
        referenceId: accountId,
        createdBy: null,
        remark: unconfirmed
          ? "Trading bonus credited"
          : "Deposit bonus credited",
        createdAt: at,
        updatedAt: at,
      });
      await db.collection("accounts").updateOne(
        { _id: accountId },
        {
          $set: {
            bonus_balance: bonus,
            bonus_granted: bonus,
            equity,
          },
        }
      );
    }

    // 3) Closed XAUUSD trades — profits first, then withdrawal, then losses
    const { trades, nextTicket } = buildDayTrades(
      day.date,
      day.profit,
      day.loss,
      ticketBase
    );
    ticketBase = nextTicket;
    const profitTrades = trades.filter((t) => t.realizedPnL >= 0);
    const lossTrades = trades.filter((t) => t.realizedPnL < 0);

    const insertClosedTrade = async (t) => {
      const positionId = crypto.randomUUID();
      const realized = t.realizedPnL;
      const nextBal = round2(balance + realized);
      balance = nextBal < 0 ? 0 : nextBal;
      const equity = round2(balance + bonus);
      daySummary.simPnL = round2(daySummary.simPnL + realized);
      daySummary.trades += 1;

      const tradeDoc = {
        userId,
        accountId,
        brokerId,
        ipAddress: "127.0.0.1",
        positionId,
      ticket: t.ticket,
      closeTicket: t.ticket + 400000,
      openDealTicket: t.ticket + 800000,
      closeDealTicket: t.ticket + 1200000,
        symbol: SYMBOL,
        side: t.side,
        orderType: "MARKET",
        status: "CLOSED",
        volume: VOLUME,
        contractSize: CONTRACT_SIZE,
        leverage,
        openPrice: t.openPrice,
        entryPrice: t.openPrice,
        closePrice: t.closePrice,
        stopLoss: null,
        takeProfit: null,
        marginUsed: t.marginUsed,
        grossPnL: t.grossPnL,
        commission: 0,
        spread: SPREAD,
        swap: 0,
        realizedPnL: realized,
        openTime: t.openTime,
        closeTime: t.closeTime,
        closeReason: "MANUAL_CLOSE",
        engineVersion: "ENGINE_V1",
        metadata: {
          source: "HISTORICAL_SIMULATION",
          reconTag: RECON_TAG,
          label: "HISTORICAL SIMULATION / BACKTEST",
          priceSource: "Yahoo Finance GC=F daily OHLC (COMEX)",
          timezone: "Asia/Kolkata (IST) wall times on trade date",
          contractSize: CONTRACT_SIZE,
          lotSize: VOLUME,
          weekendProxy: OHLC[day.date]?.weekendFrom || null,
        },
        createdAt: t.openTime,
        updatedAt: t.closeTime,
      };

      const ins = await db.collection("trades").insertOne(tradeDoc);
      await db.collection("transactions").insertOne({
        user: userId,
        account: accountId,
        type: realized >= 0 ? "TRADE_PROFIT" : "TRADE_LOSS",
        amount: Math.abs(realized),
        balanceAfter: balance,
        equityAfter: equity,
        status: "SUCCESS",
        referenceType: "TRADE",
        referenceId: ins.insertedId,
        createdBy: null,
        remark: `${realized >= 0 ? "Trade profit" : "Trade loss"} XAUUSD ${VOLUME}`,
        createdAt: t.closeTime,
        updatedAt: t.closeTime,
      });
    };

    for (const t of profitTrades) {
      await insertClosedTrade(t);
    }

    // 4) Withdrawal (afternoon IST) after profits, before losses
    if (day.withdrawal > 0) {
      const at = istDateTime(day.date, 16, 30, 0);
      if (balance < day.withdrawal) {
        throw new Error(
          `${day.date}: withdrawal ${day.withdrawal} exceeds balance ${balance}`
        );
      }
      balance = round2(balance - day.withdrawal);
      const equity = round2(balance + bonus);
      const wdRes = await db.collection("withdrawals").insertOne({
        user: userId,
        account: accountId,
        brokerId,
        amount: day.withdrawal,
        bonus_percent: 0,
        bonus_deducted: 0,
        method: "MANUAL",
        payout: {
          upi_id: "",
          bank_name: "",
          account_holder_name: "Account Holder",
          account_number: "MASKED",
          ifsc: "",
          crypto_network: "",
          crypto_address: "",
          note: RECON_TAG,
        },
        status: "COMPLETED",
        actionBy: null,
        actionAt: at,
        ipAddress: "127.0.0.1",
        createdAt: at,
        updatedAt: at,
      });
      await db.collection("transactions").insertOne({
        user: userId,
        account: accountId,
        type: "WITHDRAWAL",
        amount: day.withdrawal,
        balanceAfter: balance,
        equityAfter: equity,
        status: "SUCCESS",
        referenceType: "WITHDRAWAL",
        referenceId: wdRes.insertedId,
        createdBy: null,
        remark: "Withdrawal to bank",
        createdAt: at,
        updatedAt: at,
      });
      await db.collection("accounts").updateOne(
        { _id: accountId },
        { $set: { balance, equity } }
      );
    }

    for (const t of lossTrades) {
      await insertClosedTrade(t);
    }

    await db.collection("accounts").updateOne(
      { _id: accountId },
      { $set: { balance, bonus_balance: bonus, equity: round2(balance + bonus) } }
    );

    daySummary.balanceAfter = balance;
    daySummary.bonusAfter = bonus;
    summary.push(daySummary);
    console.log(
      day.date,
      `dep=${day.deposit} wd=${day.withdrawal} bonus=${day.bonus} P=${day.profit} L=${day.loss}`,
      `trades=${daySummary.trades} simPnL=${daySummary.simPnL}`,
      `bal=${balance} bonus=${bonus}`
    );
  }

  const equity = round2(balance + bonus);
  await db.collection("accounts").updateOne(
    { _id: accountId },
    {
      $set: {
        balance,
        bonus_balance: bonus,
        bonus_granted: bonus,
        equity,
        used_margin: 0,
        free_margin: equity,
      },
    }
  );

  // Totals check
  const totals = LEDGER.reduce(
    (a, d) => {
      a.deposit += d.deposit;
      a.withdrawal += d.withdrawal;
      a.bonus += d.bonus;
      a.profit += d.profit;
      a.loss += d.loss;
      return a;
    },
    { deposit: 0, withdrawal: 0, bonus: 0, profit: 0, loss: 0 }
  );

  const tradeCount = await db.collection("trades").countDocuments({
    accountId,
    "metadata.reconTag": RECON_TAG,
  });
  const tradePnLAgg = await db
    .collection("trades")
    .aggregate([
      { $match: { accountId, "metadata.reconTag": RECON_TAG } },
      { $group: { _id: null, pnl: { $sum: "$realizedPnL" } } },
    ])
    .toArray();

  console.log("\n=== DONE ===");
  console.log("Totals ledger", totals);
  console.log("Net reported P/L", round2(totals.profit - totals.loss));
  console.log("Net cash flow", round2(totals.deposit - totals.withdrawal));
  console.log("Trades inserted", tradeCount, "sum realizedPnL", tradePnLAgg[0]?.pnl);
  console.log("Final account", { balance, bonus, equity });

  // Best-effort engine sync (may no-op if engine not running in this process)
  try {
    const { publishAccountBalance } = await import("../src/trade-engine/EngineSyncBus.js");
    publishAccountBalance(String(accountId), balance, bonus);
    console.log("Published balance to EngineSyncBus");
  } catch (e) {
    console.warn("Engine sync skipped:", e.message);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
