import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.model.js";
import { getIbCommissionSummaryForIb } from "../src/services/ibCommission.service.js";

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

for (const email of ["anaskhany47@gmail.com","onlymoviesy047@gmail.com","codexnewcodi@gmail.com","ib.tree.l3@test.local"]) {
  const u = await User.findOne({ email }).select("_id email").lean();
  if (!u) { console.log(email, "NOT FOUND"); continue; }
  const s = await getIbCommissionSummaryForIb(u._id);
  console.log(email, "->", JSON.stringify(s));
}
await mongoose.disconnect();
