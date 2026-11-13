// Verify team members deposit/withdraw mapping fix
import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.model.js";
import { listNetworkMembersService } from "../src/services/referralDashboard.service.js";

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
const ib = await User.findOne({ email: "anaskhany47@gmail.com" }).lean();
const res = await listNetworkMembersService({
  userId: String(ib._id),
  page: 1,
  limit: 20,
});
console.log("members:", res.items.length);
for (const m of res.items) {
  console.log(
    `${m.name} | L${m.level} | dep=${m.totalDeposit} | wd=${m.totalWithdrawal} | lots=${m.lots} | comm=${m.commission}`,
  );
}
await mongoose.disconnect();
