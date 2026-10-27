import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGO_URI);
const accId = new mongoose.Types.ObjectId("6ae0ade93dcdca4c2bd1db11");
const sample = await mongoose.connection.db
  .collection("trades")
  .find({ accountId: accId })
  .sort({ closeTime: -1 })
  .limit(6)
  .project({ side: 1, openPrice: 1, closePrice: 1, realizedPnL: 1, closeTime: 1 })
  .toArray();
const remarks = await mongoose.connection.db
  .collection("transactions")
  .find({ account: accId, type: { $in: ["DEPOSIT", "WITHDRAWAL", "BONUS_MANUAL"] } })
  .sort({ createdAt: -1 })
  .limit(6)
  .project({ type: 1, amount: 1, remark: 1 })
  .toArray();
const acc = await mongoose.connection.db
  .collection("accounts")
  .findOne({ _id: accId }, { projection: { balance: 1, bonus_balance: 1, equity: 1 } });
console.log({ acc, sample, remarks });
await mongoose.disconnect();
process.exit(0);
