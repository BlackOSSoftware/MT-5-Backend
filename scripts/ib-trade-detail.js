import "dotenv/config";
import mongoose from "mongoose";
import Trade from "../src/models/Trade.model.js";
import IbCommission from "../src/models/IbCommission.model.js";

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

const ids = ["d0fac4a8-bc8c-4b14-918b-8f5198a6ff04","0c339ecf-774b-4ffd-9819-920cc8cda64f","6cfc2f49-75c3-47de-aaed-f2dbfb8777ac","84a7611d-4976-4cd2-9d21-cc5a2f383479","e0f0fb00-3616-4803-922b-39fe4836519e"];
for (const id of ids) {
  const t = await Trade.findOne({ positionId: id }).lean();
  if (!t) { console.log(id, "NOT FOUND by positionId"); continue; }
  console.log(JSON.stringify({
    positionId: t.positionId, createdAt: t.createdAt, openTime: t.openTime, closeTime: t.closeTime,
    source: t.source, ipAddress: t.ipAddress, userId: t.userId, accountId: t.accountId,
    symbol: t.symbol, side: t.side, status: t.status, lots: t.lots ?? t.volume,
  }));
}
// also check a working WEB trade for comparison
const w = await Trade.findOne({ positionId: "40a60694-e342-4504-89b4-3e6a03d380ff" }).lean();
console.log("WEB sample:", JSON.stringify({ positionId: w?.positionId, createdAt: w?.createdAt, source: w?.source, ipAddress: w?.ipAddress, userId: w?.userId, accountId: w?.accountId, status: w?.status }));
await mongoose.disconnect();
