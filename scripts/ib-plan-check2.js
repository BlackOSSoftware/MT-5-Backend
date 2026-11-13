import "dotenv/config";
import mongoose from "mongoose";
import Account from "../src/models/Account.model.js";
import AccountPlan from "../src/models/AccountPlan.model.js";
import { getPlanSymbolSpreadRow, resolveSpreadFromRow } from "../src/services/spreadResolver.service.js";

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

const acc = await Account.findById("6af339e0debba83642523ff3").lean();
console.log("account:", acc.account_number, "type:", acc.account_type, "plan_id:", acc.account_plan_id, "plan_name:", acc.plan_name);
const plan = acc.account_plan_id ? await AccountPlan.findById(acc.account_plan_id).lean() : null;
console.log("plan doc:", plan ? { name: plan.name || plan.plan_name, keys: Object.keys(plan) } : null);

for (const sym of ["XAUUSD", "EURUSD"]) {
  const row = await getPlanSymbolSpreadRow(acc.account_plan_id, sym);
  console.log(sym, "planRow:", JSON.stringify(row));
  const resolved = resolveSpreadFromRow({ planRow: row, planPricingEnabled: true });
  console.log(sym, "resolved ibUsdPerLot:", resolved.ibUsdPerLot, "house:", resolved.houseUsdPerLot);
}
await mongoose.disconnect();
