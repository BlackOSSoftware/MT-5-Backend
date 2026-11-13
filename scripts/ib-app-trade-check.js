// Diagnose why app trades may not generate IB commission.
import "dotenv/config";
import mongoose from "mongoose";
import Trade from "../src/models/Trade.model.js";
import IbCommission from "../src/models/IbCommission.model.js";
import Account from "../src/models/Account.model.js";
import AccountPlan from "../src/models/AccountPlan.model.js";
import Referral from "../src/models/Referral.model.js";
import User from "../src/models/User.model.js";

function resolveSrvUri(srvUri) {
  const m = String(srvUri).match(/^mongodb\+srv:\/\/([^@]+)@([^/]+)\/([^?]*)(\?(.*))?$/);
  if (!m) return srvUri;
  const [, creds, , db, , query] = m;
  const hosts = [
    "ac-dbovm6k-shard-00-00.t5j2ruj.mongodb.net",
    "ac-dbovm6k-shard-00-01.t5j2ruj.mongodb.net",
    "ac-dbovm6k-shard-00-02.t5j2ruj.mongodb.net",
  ].join(",");
  let cleanQuery = (query || "").split("&").filter((p) => p && !p.startsWith("replicaSet=")).join("&");
  if (!/(^|&)tls=/.test(cleanQuery) && !/(^|&)ssl=/.test(cleanQuery)) cleanQuery = cleanQuery ? `${cleanQuery}&tls=true` : "tls=true";
  return `mongodb://${creds}@${hosts}/${db}${cleanQuery ? `?${cleanQuery}` : ""}`;
}

await mongoose.connect(resolveSrvUri(process.env.MONGO_URI));
console.log("DB connected\n");

// 1. Recent trades (last 15) with source + account + user
const trades = await Trade.find({}).sort({ createdAt: -1 }).limit(15).lean();
console.log("=== LAST 15 TRADES ===");
for (const t of trades) {
  const acc = await Account.findById(t.account_id || t.accountId).select("user_id account_number plan_id account_type status").lean();
  const u = acc ? await User.findById(acc.user_id).select("email").lean() : null;
  console.log(
    `${t.createdAt?.toISOString?.() || t.createdAt} | id=${t._id} | pos=${t.positionId || t.position_id || "-"} | sym=${t.symbol} | src=${t.source || "-"} | user=${u?.email || "?"} | acc=${acc?.account_number || "?"} | plan=${acc?.plan_id || "-"} | status=${t.status}`,
  );
}

// 2. Recent IbCommission rows
const comms = await IbCommission.find({}).sort({ createdAt: -1 }).limit(15).lean();
console.log("\n=== LAST 15 IB COMMISSION ROWS ===");
for (const c of comms) {
  console.log(`${c.createdAt?.toISOString?.()} | trade_id=${c.trade_id} | ib=${c.ib_user_id} | lvl=${c.level} | amt=$${c.amount} | status=${c.status}`);
}

// 3. For each recent trade, check if commission rows exist
console.log("\n=== COMMISSION COVERAGE FOR LAST 15 TRADES ===");
for (const t of trades) {
  const tid = String(t.positionId || t.position_id || t._id);
  const n = await IbCommission.countDocuments({ trade_id: tid });
  const acc = await Account.findById(t.account_id || t.accountId).select("user_id plan_id").lean();
  const ref = acc ? await Referral.findOne({ user_id: acc.user_id }).lean() : null;
  console.log(`trade ${tid} src=${t.source || "-"} -> commission rows=${n} | trader=${acc?.user_id} referred_by=${ref?.referred_by || "NONE"} plan=${acc?.plan_id}`);
}

// 4. Plan spread / IB settings check for involved plans
const planIds = [...new Set(trades.map((t) => null))]; // placeholder
const accs = await Account.find({}).sort({ createdAt: -1 }).limit(10).select("user_id plan_id account_number").lean();
console.log("\n=== RECENT ACCOUNTS + PLANS ===");
for (const a of accs) {
  const plan = a.plan_id ? await AccountPlan.findById(a.plan_id).lean() : null;
  console.log(`acc=${a.account_number} plan=${plan?.name || plan?.plan_name || a.plan_id} planId=${a.plan_id}`);
}

await mongoose.disconnect();
console.log("\nDone.");
