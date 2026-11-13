import "dotenv/config";
import mongoose from "mongoose";
import Trade from "../src/models/Trade.model.js";
import IbCommission from "../src/models/IbCommission.model.js";
import { creditIbOnFill } from "../src/services/ibCommission.service.js";

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

const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
const trades = await Trade.find({ openTime: { $gte: since }, positionId: { $exists: true, $ne: null } })
  .select("positionId accountId symbol lots volume openTime")
  .sort({ openTime: -1 }).limit(200).lean();

const ids = trades.map((t) => String(t.positionId));
const existing = await IbCommission.find({ trade_id: { $in: ids } }).select("trade_id").lean();
const covered = new Set(existing.map((r) => String(r.trade_id)));

let credited = 0;
for (const t of trades) {
  const tid = String(t.positionId);
  if (covered.has(tid)) continue;
  const lots = Number(t.lots ?? t.volume ?? 0);
  if (!(lots > 0)) continue;
  const res = await creditIbOnFill({ tradeId: tid, positionId: tid, accountId: String(t.accountId), symbol: t.symbol, lots });
  console.log(tid, t.symbol, "lots=" + lots, "->", JSON.stringify(res));
  if (res && !res.skipped) credited += 1;
}
console.log("credited:", credited);
await mongoose.disconnect();
