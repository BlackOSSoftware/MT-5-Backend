/**
 * Leave a small natural cash balance on account 4810033902 by shifting
 * from bonus → balance (equity unchanged). Does not alter trades.
 */
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

const ACCOUNT_NUMBER = "4810033902";
const CASH = 27.84; // natural leftover points

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
const account = await db.collection("accounts").findOne({ account_number: ACCOUNT_NUMBER });
if (!account) throw new Error("account not found");

const bonus = Number(account.bonus_balance) || 0;
if (bonus < CASH) throw new Error(`bonus ${bonus} < cash ${CASH}`);

const balance = CASH;
const bonus_balance = Math.round((bonus - CASH) * 100) / 100;
const equity = Math.round((balance + bonus_balance) * 100) / 100;

await db.collection("accounts").updateOne(
  { _id: account._id },
  {
    $set: {
      balance,
      bonus_balance,
      equity,
      free_margin: equity,
      used_margin: 0,
    },
  }
);

console.log({
  before: { balance: account.balance, bonus: account.bonus_balance, equity: account.equity },
  after: { balance, bonus_balance, equity },
});

try {
  const { publishAccountBalance } = await import("../src/trade-engine/EngineSyncBus.js");
  publishAccountBalance(String(account._id), balance, bonus_balance);
} catch (e) {
  console.warn("engine sync skip", e.message);
}

await mongoose.disconnect();
process.exit(0);
