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

const ids = ["d0fac4a8-bc8c-4b14-918b-8f5198a6ff04","0c339ecf-774b-4ffd-9819-920cc8cda64f","6cfc2f49-75c3-47de-aaed-f2dbfb8777ac","84a7611d-4976-4cd2-9d21-cc5a2f383479","e0f0fb00-3616-4803-922b-39fe4836519e"];
const rows = await IbCommission.find({ trade_id: { $in: ids } }).lean();
const users = await User.find({ _id: { $in: [...new Set(rows.map((r) => r.ib_user_id))] } }).select("email").lean();
const emap = new Map(users.map((u) => [String(u._id), u.email]));
for (const id of ids) {
  const rs = rows.filter((r) => r.trade_id === id);
  console.log(id, "->", rs.length ? rs.map((r) => `${emap.get(String(r.ib_user_id))} L${r.level} $${r.amount} ${r.status}`).join(" | ") : "NO COMMISSION");
}
await mongoose.disconnect();
