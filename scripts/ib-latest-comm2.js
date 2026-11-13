import "dotenv/config";
import mongoose from "mongoose";
import IbCommission from "../src/models/IbCommission.model.js";
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

const since = new Date(Date.now() - 20 * 60 * 1000);
const rows = await IbCommission.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).lean();
console.log("=== IB COMMISSION ROWS LAST 90MIN ===", rows.length);
const uids = [...new Set(rows.flatMap((r) => [r.ib_user_id, r.trader_user_id]))];
const users = await User.find({ _id: { $in: uids } }).select("email").lean();
const emap = new Map(users.map((u) => [String(u._id), u.email]));
for (const r of rows) {
  console.log(`${r.createdAt} | trade=${r.trade_id} | ib=${emap.get(String(r.ib_user_id))} L${r.level} $${r.amount} ${r.status} | trader=${emap.get(String(r.trader_user_id))}`);
}
await mongoose.disconnect();
