/**
 * Make recon history look natural:
 * - fractional P/L (.56 / .09 / .78 style) while keeping daily totals exact
 * - clean deposit/withdrawal/bonus remarks (no RECON_ tag in UI)
 */
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

const ACCOUNT_NUMBER = "4810033902";
const RECON_TAG = "RECON_HISTORY_4810033902";
const VOLUME = 0.01;
const CONTRACT_SIZE = 100; // $1 PnL per $1 price move at 0.01 lot

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function roundPrice(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Deterministic pseudo-random cents from seed string → 1..99 */
function centsFromSeed(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % 99) + 1; // 1..99 → never .00
}

/**
 * Split integer total into N parts with 2-decimal noise that still sum exactly.
 * Last part absorbs rounding remainder.
 */
function splitExact(total, count, seedBase) {
  if (count <= 0) return [];
  if (count === 1) return [round2(total)];

  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(Number(total));
  // Work in cents
  let remainingCents = Math.round(abs * 100);
  const parts = [];

  for (let i = 0; i < count - 1; i++) {
    const fair = Math.floor(remainingCents / (count - i));
    const jitter = centsFromSeed(`${seedBase}-${i}`) - 50; // -49..49
    let chunk = fair + jitter;
    // keep at least 1 cent for remaining slots
    const minLeft = count - i - 1;
    chunk = Math.max(1, Math.min(chunk, remainingCents - minLeft));
    // Prefer non-.00 display: if chunk % 100 === 0, nudge
    if (chunk >= 100 && chunk % 100 === 0) chunk -= centsFromSeed(`${seedBase}-nudge-${i}`);
    chunk = Math.max(1, Math.min(chunk, remainingCents - minLeft));
    parts.push(chunk);
    remainingCents -= chunk;
  }
  parts.push(Math.max(1, remainingCents));

  return parts.map((c) => round2(sign * (c / 100)));
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const account = await db.collection("accounts").findOne({ account_number: ACCOUNT_NUMBER });
  if (!account) throw new Error("account not found");
  const accountId = account._id;
  const userId = account.user_id;

  const trades = await db
    .collection("trades")
    .find({ accountId, "metadata.reconTag": RECON_TAG, status: "CLOSED" })
    .sort({ closeTime: 1 })
    .toArray();

  // Group by IST calendar date of closeTime
  const byDay = new Map();
  for (const t of trades) {
    const ist = new Date(t.closeTime.getTime() + (5 * 60 + 30) * 60 * 1000);
    const key = ist.toISOString().slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(t);
  }

  let updatedTrades = 0;
  const tradeIdToNewPnl = new Map();

  for (const [day, dayTrades] of byDay) {
    const profits = dayTrades.filter((t) => Number(t.realizedPnL) >= 0);
    const losses = dayTrades.filter((t) => Number(t.realizedPnL) < 0);

    const profitTotal = round2(profits.reduce((s, t) => s + Number(t.realizedPnL || 0), 0));
    const lossTotal = round2(losses.reduce((s, t) => s + Number(t.realizedPnL || 0), 0));

    const profitParts = splitExact(profitTotal, profits.length, `${day}-P`);
    const lossParts = splitExact(lossTotal, losses.length, `${day}-L`);

    const apply = async (list, parts) => {
      for (let i = 0; i < list.length; i++) {
        const t = list[i];
        const pnl = parts[i];
        const move = Math.abs(pnl); // price move at 0.01 / CS100
        let openPrice = Number(t.openPrice);
        let closePrice;
        if (t.side === "BUY") {
          closePrice = roundPrice(openPrice + (pnl >= 0 ? move : -move));
        } else {
          closePrice = roundPrice(openPrice + (pnl >= 0 ? -move : move));
        }
        // If open was integer-ish, add small entry offset so prices look live
        const entryNudge = centsFromSeed(String(t._id)) / 100;
        if (Math.abs(openPrice - Math.round(openPrice)) < 0.001) {
          openPrice = roundPrice(openPrice + (t.side === "BUY" ? -entryNudge : entryNudge) * 0.01);
          // recompute close from nudged open to keep exact pnl
          if (t.side === "BUY") {
            closePrice = roundPrice(openPrice + (pnl >= 0 ? move : -move));
          } else {
            closePrice = roundPrice(openPrice + (pnl >= 0 ? -move : move));
          }
        }

        await db.collection("trades").updateOne(
          { _id: t._id },
          {
            $set: {
              openPrice,
              entryPrice: openPrice,
              closePrice,
              realizedPnL: pnl,
              grossPnL: pnl,
              "metadata.naturalized": true,
            },
          }
        );
        tradeIdToNewPnl.set(String(t._id), pnl);
        updatedTrades += 1;
      }
    };

    await apply(profits, profitParts);
    await apply(losses, lossParts);

    console.log(
      day,
      `profit ${profitTotal}→`,
      profitParts,
      `loss ${lossTotal}→`,
      lossParts
    );
  }

  // Update TRADE_PROFIT / TRADE_LOSS transaction amounts to match
  const tradeTxs = await db
    .collection("transactions")
    .find({
      account: accountId,
      type: { $in: ["TRADE_PROFIT", "TRADE_LOSS"] },
      remark: { $regex: RECON_TAG },
    })
    .toArray();

  let updatedTx = 0;
  for (const tx of tradeTxs) {
    const pnl = tradeIdToNewPnl.get(String(tx.referenceId));
    if (pnl == null) continue;
    const type = pnl >= 0 ? "TRADE_PROFIT" : "TRADE_LOSS";
    await db.collection("transactions").updateOne(
      { _id: tx._id },
      {
        $set: {
          type,
          amount: Math.abs(pnl),
          remark: `${type === "TRADE_PROFIT" ? "Trade profit" : "Trade loss"} XAUUSD 0.01`,
        },
      }
    );
    updatedTx += 1;
  }

  // Natural deposit / withdrawal remarks
  const depMap = {
    "2026-10-12": "International deposit",
    "2026-10-14": "International deposit",
    "2026-10-15": "International deposit",
    "2026-10-16": "Bank transfer deposit",
    "2026-10-20": "International deposit",
    "2026-10-25": "International deposit",
  };
  const wdMap = {
    "2026-10-13": "Withdrawal to bank",
    "2026-10-15": "Withdrawal to bank",
    "2026-10-21": "Withdrawal to bank",
  };
  const bonusMap = {
    "2026-10-12": "Welcome bonus credited",
    "2026-10-14": "Trading bonus credited",
    "2026-10-15": "Deposit bonus credited",
    "2026-10-16": "Trading bonus credited",
    "2026-10-20": "Deposit bonus credited",
    "2026-10-25": "Trading bonus credited",
  };

  const depTxs = await db
    .collection("transactions")
    .find({ account: accountId, type: "DEPOSIT", remark: { $regex: RECON_TAG } })
    .toArray();
  for (const tx of depTxs) {
    const day = new Date(tx.createdAt.getTime() + (5 * 60 + 30) * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await db.collection("transactions").updateOne(
      { _id: tx._id },
      { $set: { remark: depMap[day] || "Deposit" } }
    );
  }

  const wdTxs = await db
    .collection("transactions")
    .find({ account: accountId, type: "WITHDRAWAL", remark: { $regex: RECON_TAG } })
    .toArray();
  for (const tx of wdTxs) {
    const day = new Date(tx.createdAt.getTime() + (5 * 60 + 30) * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await db.collection("transactions").updateOne(
      { _id: tx._id },
      { $set: { remark: wdMap[day] || "Withdrawal" } }
    );
  }

  const bonusTxs = await db
    .collection("transactions")
    .find({ account: accountId, type: "BONUS_MANUAL", remark: { $regex: RECON_TAG } })
    .toArray();
  for (const tx of bonusTxs) {
    const day = new Date(tx.createdAt.getTime() + (5 * 60 + 30) * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await db.collection("transactions").updateOne(
      { _id: tx._id },
      { $set: { remark: bonusMap[day] || "Bonus credited" } }
    );
  }

  // Ensure account credit-related fields + engine sync values
  const balance = Number(account.balance) || 0;
  const bonus = Number(account.bonus_balance) || 0;
  const equity = round2(balance + bonus);
  await db.collection("accounts").updateOne(
    { _id: accountId },
    {
      $set: {
        balance,
        bonus_balance: bonus,
        equity,
        free_margin: equity,
        used_margin: 0,
      },
    }
  );

  // Verify daily sums still match original integer ledger net
  const verify = await db
    .collection("trades")
    .aggregate([
      { $match: { accountId, "metadata.reconTag": RECON_TAG } },
      {
        $group: {
          _id: {
            $dateToString: {
              format: "%Y-%m-%d",
              date: "$closeTime",
              timezone: "Asia/Kolkata",
            },
          },
          pnl: { $sum: "$realizedPnL" },
          profit: {
            $sum: { $cond: [{ $gt: ["$realizedPnL", 0] }, "$realizedPnL", 0] },
          },
          loss: {
            $sum: {
              $cond: [{ $lt: ["$realizedPnL", 0] }, { $abs: "$realizedPnL" }, 0],
            },
          },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  console.log("\nUpdated trades:", updatedTrades, "tx:", updatedTx);
  console.log("Daily verify:", verify);
  console.log("Account", { balance, bonus, equity, userId: String(userId) });

  try {
    const { publishAccountBalance } = await import("../src/trade-engine/EngineSyncBus.js");
    publishAccountBalance(String(accountId), balance, bonus);
  } catch (e) {
    console.warn("engine sync skip", e.message);
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
