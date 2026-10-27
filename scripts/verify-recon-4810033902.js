import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGO_URI);
const accId = new mongoose.Types.ObjectId("6ae0ade93dcdca4c2bd1db11");
const db = mongoose.connection.db;

const acc = await db.collection("accounts").findOne({ _id: accId });
const deps = await db.collection("deposits").find({ account: accId }).sort({ createdAt: 1 }).toArray();
const wds = await db.collection("withdrawals").find({ account: accId }).sort({ createdAt: 1 }).toArray();
const bonuses = await db
  .collection("transactions")
  .find({ account: accId, type: "BONUS_MANUAL" })
  .sort({ createdAt: 1 })
  .toArray();
const byDay = await db
  .collection("trades")
  .aggregate([
    { $match: { accountId: accId, "metadata.reconTag": "RECON_HISTORY_4810033902" } },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$closeTime", timezone: "Asia/Kolkata" },
        },
        count: { $sum: 1 },
        pnl: { $sum: "$realizedPnL" },
        profit: {
          $sum: { $cond: [{ $gt: ["$realizedPnL", 0] }, "$realizedPnL", 0] },
        },
        loss: {
          $sum: { $cond: [{ $lt: ["$realizedPnL", 0] }, { $abs: "$realizedPnL" }, 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ])
  .toArray();
const sample = await db.collection("trades").find({ accountId: accId }).sort({ closeTime: 1 }).limit(4).toArray();

console.log("ACCOUNT", { bal: acc.balance, bonus: acc.bonus_balance, equity: acc.equity });
console.log(
  "DEPOSITS",
  deps.map((d) => ({ amt: d.amount, at: d.createdAt.toISOString() }))
);
console.log(
  "WITHDRAWALS",
  wds.map((w) => ({ amt: w.amount, at: w.createdAt.toISOString() }))
);
console.log(
  "BONUSES",
  bonuses.map((b) => ({ amt: b.amount, remark: b.remark, at: b.createdAt.toISOString() }))
);
console.log("P/L BY DAY", byDay);
console.log(
  "SAMPLE",
  sample.map((t) => ({
    side: t.side,
    vol: t.volume,
    open: t.openPrice,
    close: t.closePrice,
    pnl: t.realizedPnL,
    openTime: t.openTime.toISOString(),
    closeTime: t.closeTime.toISOString(),
    label: t.metadata?.label,
  }))
);

await mongoose.disconnect();
process.exit(0);
