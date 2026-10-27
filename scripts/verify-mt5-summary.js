import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";
import { getTradeSummaryService } from "../src/services/tradeOrder.service.js";

await mongoose.connect(process.env.MONGO_URI);
const acc = await mongoose.connection.db
  .collection("accounts")
  .findOne({ account_number: "4810033902" });
const summary = await getTradeSummaryService({ accountId: String(acc._id) });
console.log({
  account: {
    balance: acc.balance,
    bonus: acc.bonus_balance,
    equity: acc.equity,
  },
  summary,
  expected: {
    totalPnL: -1400,
    totalDeposit: 1300,
    totalWithdraw: 250,
    totalSwap: 0,
    totalCommission: 0,
    balance: 0,
  },
});
await mongoose.disconnect();
process.exit(0);
