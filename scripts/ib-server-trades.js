import "dotenv/config";
import mongoose from "mongoose";
import Trade from "../src/models/Trade.model.js";
import IbCommission from "../src/models/IbCommission.model.js";
import Account from "../src/models/Account.model.js";
import User from "../src/models/User.model.js";

function resolveSrvUri(srvUri) {
  const m = String(srvUri).match(/^mongodb\+srv:\/\/([^@]+)@([^/]+)\/([^?]*)(\?(.*))?$/);
  if (!m) return srvUri;
  const [, creds, , db, , query] = m;
  const hosts = ["ac-dbovm6k-shard-00-00.t5j2ruj.mongodb.net","ac-dbovm6k-shard-00-01.t5j2ruj.mongodb.net","ac-dbovm6k-shard-00-02.t5j2ruj.mongodb.net"].join(",");
  let cleanQuery = (query || "").split("&").filter((p) => p && !p.startsWith("replicaSet=")).join("&");
  if (!/(^|&)tls=/.test(cleanQuery) && !/(^|&)ssl=/.test(cleanQuery)) cleanQuery = cleanQuery ? `${cleanQuery}&tls=true` : "tls=true";
  return `mongodb://${creds}@${hosts}/${db}${cleanQuery ? `?${cleanQuery}` : ""}`;
}
await mongoose.connect(resolveSrvUri(process.env.MONGO_URI));

const since = new Date(Date.now() - 3 * 60 * 60 * 1000);
const trades = await Trade.find({ openTime: { $gte: since } }).sort({ openTime: -1 }).limit(20).lean();
console.log("=== TRADES LAST 3H ===", trades.length);
for (const t of trades) {
  const acc = await Account.findById(t.accountId).select("user_id account_number account_type account_plan_id").lean();
  const u = acc ? await User.findById(acc.user_id).select("email").lean() : null;
  const n = await IbCommission.countDocuments({ trade_id: String(t.positionId) });
  console.log(`${t.openTime} | ${t.positionId} | ${t.symbol} ${t.side} ${t.lots} | src=${t.source || "NULL"} | ${u?.email} | ${acc?.account_number} ${acc?.account_type} | commRows=${n}`);
}
await mongoose.disconnect();
