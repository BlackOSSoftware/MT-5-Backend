// Local test: IB spread-share commission credit + report (cleans up after itself)
import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.model.js";
import Account from "../src/models/Account.model.js";
import Trade from "../src/models/Trade.model.js";
import IbCommission from "../src/models/IbCommission.model.js";
import { creditIbOnFill, listIbCommissionReportForIb } from "../src/services/ibCommission.service.js";

function resolveSrvUri(srvUri) {
  const m = String(srvUri).match(/^mongodb\+srv:\/\/([^@]+)@([^/]+)\/([^?]*)(\?(.*))?$/);
  if (!m) return srvUri;
  const [, creds, , db, , query] = m;
  const hosts = [
    "ac-dbovm6k-shard-00-00.t5j2ruj.mongodb.net",
    "ac-dbovm6k-shard-00-01.t5j2ruj.mongodb.net",
    "ac-dbovm6k-shard-00-02.t5j2ruj.mongodb.net",
  ].join(",");
  let cleanQuery = (query || "")
    .split("&")
    .filter((p) => p && !p.startsWith("replicaSet="))
    .join("&");
  if (!/(^|&)tls=/.test(cleanQuery) && !/(^|&)ssl=/.test(cleanQuery)) {
    cleanQuery = cleanQuery ? `${cleanQuery}&tls=true` : "tls=true";
  }
  return `mongodb://${creds}@${hosts}/${db}${cleanQuery ? `?${cleanQuery}` : ""}`;
}

await mongoose.connect(resolveSrvUri(process.env.MONGO_URI));
console.log("DB connected | flags:", process.env.PLAN_SPREAD_PRICING, process.env.IB_SPREAD_COMMISSION);

const trader = await User.findOne({ email: "codexnewcodi@gmail.com" }).lean();
const account = await Account.findOne({
  user_id: trader._id,
  account_type: "live",
  status: "active",
}).lean();
console.log("trader:", trader.email, "| account:", account.account_number, "| plan:", account.account_plan_id);

const TEST_TRADE = "TESTPOS-IB-" + Date.now();
const LOTS = 0.09;

// Fake closed trade so the report join has closeTime/profit/duration
const closeTime = new Date();
const openTime = new Date(closeTime.getTime() - (2 * 3600 + 42 * 60 + 6) * 1000);
await Trade.create({
  userId: trader._id,
  accountId: account._id,
  ipAddress: "TEST",
  positionId: TEST_TRADE,
  symbol: "XAUUSD",
  side: "BUY",
  orderType: "MARKET",
  status: "CLOSED",
  volume: LOTS,
  contractSize: 100,
  leverage: 100,
  openPrice: 4000,
  closePrice: 3990,
  marginUsed: 40,
  realizedPnL: -89.01,
  openTime,
  closeTime,
  closeReason: "MANUAL",
});
console.log("fake trade created:", TEST_TRADE);

const result = await creditIbOnFill({
  tradeId: TEST_TRADE,
  positionId: TEST_TRADE,
  accountId: String(account._id),
  symbol: "XAUUSD",
  lots: LOTS,
  instrument: { spread: 0, spread_mode: "ADD_ON", contractSize: 100 },
});
console.log("\n== creditIbOnFill result ==");
console.log(JSON.stringify(result, null, 2));

const rows = await IbCommission.find({ trade_id: TEST_TRADE }).lean();
console.log("\n== IbCommission rows ==");
for (const r of rows) {
  const ib = await User.findById(r.ib_user_id).select("email").lean();
  console.log(
    `ib=${ib?.email} level=${r.level} percent=${r.percent}% ibUsd/lot=${r.ib_usd_per_lot} lots=${r.lots} amount=${r.amount} status=${r.status}`,
  );
}
// Expected: budget = 35 * 0.09 = 3.15 → L1 70% = 2.205, L2 30% = 0.945

for (const email of ["onlymoviesy047@gmail.com", "anaskhany47@gmail.com"]) {
  const ibUser = await User.findOne({ email }).lean();
  const report = await listIbCommissionReportForIb(ibUser._id, { q: "", page: 1, limit: 10 });
  console.log(`\n== REPORT for ${email} == totals:`, JSON.stringify(report.totals));
  for (const item of report.items.slice(0, 3)) {
    console.log(
      `L${item.level} ${item.clientName} ${item.symbol} lots=${item.lots} comm=${item.commission} profit=${item.profit} pos=${item.positionId} close=${item.closeTime} dur=${item.duration} acctType=${item.accountType} src=${item.source}`,
    );
  }
}

// cleanup test data
await IbCommission.deleteMany({ trade_id: TEST_TRADE });
await Trade.deleteOne({ positionId: TEST_TRADE });
console.log("\ncleanup done");

await mongoose.disconnect();
