// Fix stale account_plan_id references: accounts whose plan_id points to a
// deleted AccountPlan get re-linked by plan_name when a unique match exists.
import "dotenv/config";
import mongoose from "mongoose";
import Account from "../src/models/Account.model.js";
import AccountPlan from "../src/models/AccountPlan.model.js";
import Instrument from "../src/models/Instrument.model.js";
import Trade from "../src/models/Trade.model.js";
import User from "../src/models/User.model.js";
import { creditIbOnFill } from "../src/services/ibCommission.service.js";

function resolveSrvUri(srvUri) {
  const m = String(srvUri).match(
    /^mongodb\+srv:\/\/([^@]+)@([^/]+)\/([^?]*)(\?(.*))?$/,
  );
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
console.log("DB connected");

const plans = await AccountPlan.find({}).select("_id name brokerId").lean();
const planIds = new Set(plans.map((p) => String(p._id)));

const accounts = await Account.find({ account_type: "live" })
  .select("user_id account_number plan_name account_plan_id")
  .lean();

const stale = accounts.filter(
  (a) => !a.account_plan_id || !planIds.has(String(a.account_plan_id)),
);
console.log("== STALE PLAN REFS ==", stale.length);

const norm = (s) => String(s || "").trim().toLowerCase();
for (const a of stale) {
  const matches = plans.filter((p) => norm(p.name) === norm(a.plan_name));
  if (matches.length !== 1) {
    console.log(
      `SKIP ${a.account_number} plan_name="${a.plan_name}" matches=${matches.length}`,
    );
    continue;
  }
  await Account.updateOne(
    { _id: a._id },
    { $set: { account_plan_id: matches[0]._id } },
  );
  console.log(
    `FIXED ${a.account_number} "${a.plan_name}" -> ${matches[0]._id} (${matches[0].name})`,
  );
}

const mismatched = accounts.filter((a) => {
  if (!a.account_plan_id || !planIds.has(String(a.account_plan_id))) return false;
  const p = plans.find((x) => String(x._id) === String(a.account_plan_id));
  return p && norm(p.name) !== norm(a.plan_name);
});
console.log("\n== NAME/PLAN MISMATCH (report only) ==", mismatched.length);
for (const a of mismatched) {
  const p = plans.find((x) => String(x._id) === String(a.account_plan_id));
  console.log(
    `${a.account_number} plan_name="${a.plan_name}" -> plan "${p?.name}"`,
  );
}

// Retro-credit IB commission for onlymoviesy's live trades
const onlymoviesy = await User.findOne({ email: "onlymoviesy047@gmail.com" })
  .select("_id")
  .lean();
const acct = await Account.findOne({
  user_id: onlymoviesy._id,
  account_type: "live",
}).lean();
console.log("\nacct plan_id now:", acct.account_plan_id);

const trades = await Trade.find({
  accountId: acct._id,
  status: { $in: ["OPEN", "CLOSED"] },
})
  .sort({ openTime: -1 })
  .limit(10)
  .lean();

const inst = await Instrument.findOne({ code: "XAUUSD" })
  .select("spread spread_mode contractSize")
  .lean();

console.log("== RETRO CREDIT ==", trades.length, "trades");
for (const t of trades) {
  const res = await creditIbOnFill({
    tradeId: String(t.positionId),
    positionId: String(t.positionId),
    accountId: String(acct._id),
    symbol: t.symbol,
    lots: t.volume,
    instrument: inst
      ? {
          spread: inst.spread,
          spread_mode: inst.spread_mode,
          contractSize: inst.contractSize,
        }
      : null,
  });
  console.log(`${t.symbol} ${t.volume} lots ->`, JSON.stringify(res));
}

await mongoose.disconnect();
console.log("\nDone.");
