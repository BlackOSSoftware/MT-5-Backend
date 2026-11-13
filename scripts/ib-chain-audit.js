// Local diagnostic: IB commission test chain (read-only)
import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.model.js";
import Referral from "../src/models/Referral.model.js";
import Account from "../src/models/Account.model.js";
import IbLevelSettings from "../src/models/IbLevelSettings.model.js";
import PlanSymbolSpread from "../src/models/PlanSymbolSpread.model.js";
import IbCommission from "../src/models/IbCommission.model.js";
import AccountPlan from "../src/models/AccountPlan.model.js";

const emails = [
  "anaskhany47@gmial.com",
  "onlymoviesy047@gmail.com",
  "codexnewcodi@gmail.com",
];

// Corporate DNS refuses Node SRV lookups — resolve shards via nslookup once
// and connect with a standard mongodb:// URI (same credentials/db/options).
function resolveSrvUri(srvUri) {
  const m = String(srvUri).match(
    /^mongodb\+srv:\/\/([^@]+)@([^/]+)\/([^?]*)(\?(.*))?$/,
  );
  if (!m) return srvUri;
  const [, creds, cluster, db, , query] = m;
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

const users = await User.find({
  $or: [
    { email: { $in: emails } },
    { email: /anaskhany/i },
    { name: /anaskhany/i },
  ],
})
  .select("_id name email")
  .lean();
console.log("\n== USERS ==");
for (const u of users) console.log(u._id, u.name, u.email);
const missing = emails.filter((e) => !users.find((u) => u.email === e));
if (missing.length) console.log("MISSING:", missing);

// Also resolve referral parents that aren't in the email list
const parentIds = (
  await Referral.find({ user_id: { $in: users.map((u) => u._id) } })
    .select("referred_by")
    .lean()
).map((r) => r.referred_by).filter(Boolean);
const extraUsers = await User.find({ _id: { $in: parentIds } })
  .select("_id name email")
  .lean();
for (const eu of extraUsers) {
  if (!users.find((u) => String(u._id) === String(eu._id))) users.push(eu);
}

const ids = users.map((u) => u._id);
const refs = await Referral.find({ user_id: { $in: ids } })
  .select("user_id referred_by referral_code total_referrals")
  .lean();
console.log("\n== REFERRALS ==");
for (const r of refs) {
  const u = users.find((x) => String(x._id) === String(r.user_id));
  const p = users.find((x) => String(x._id) === String(r.referred_by));
  console.log(
    `${u?.email} <- referred_by ${p?.email || r.referred_by} (code ${r.referral_code}, total ${r.total_referrals})`,
  );
}

const accounts = await Account.find({ user_id: { $in: ids } })
  .select(
    "user_id account_number account_type status account_plan_id plan_name balance commission_per_lot",
  )
  .populate("account_plan_id", "name commission_per_lot referral_reward_amount")
  .lean();
console.log("\n== ACCOUNTS ==");
for (const a of accounts) {
  const u = users.find((x) => String(x._id) === String(a.user_id));
  console.log(
    `${u?.email} | ${a.account_number} | ${a.account_type} | ${a.status} | plan=${a.plan_name} (${a.account_plan_id?._id}) | bal=${a.balance} | comm/lot=${a.commission_per_lot}`,
  );
}

const settings = await IbLevelSettings.find({}).lean();
console.log("\n== IB LEVEL SETTINGS ==");
console.log(JSON.stringify(settings, null, 2));

const planIds = [
  ...new Set(accounts.map((a) => a.account_plan_id?._id).filter(Boolean)),
];
if (planIds.length) {
  const spreads = await PlanSymbolSpread.find({ planId: { $in: planIds } })
    .select("planId symbol house_usd_per_lot ib_usd_per_lot isActive")
    .lean();
  console.log("\n== PLAN SPREADS ==", spreads.length, "rows");
  for (const s of spreads.slice(0, 30)) {
    console.log(
      `plan=${s.planId} ${s.symbol} house=${s.house_usd_per_lot} ib=${s.ib_usd_per_lot} active=${s.isActive}`,
    );
  }
}

const comms = await IbCommission.find({ ib_user_id: { $in: ids } })
  .select("ib_user_id trader_user_id symbol lots level amount status trade_id")
  .sort({ createdAt: -1 })
  .limit(20)
  .lean();
console.log("\n== EXISTING IB COMMISSIONS ==", comms.length);
for (const c of comms) {
  const ib = users.find((x) => String(x._id) === String(c.ib_user_id));
  const tr = users.find((x) => String(x._id) === String(c.trader_user_id));
  console.log(
    `ib=${ib?.email} trader=${tr?.email} ${c.symbol} lots=${c.lots} L${c.level} amt=${c.amount} ${c.status} trade=${c.trade_id}`,
  );
}

await mongoose.disconnect();
console.log("\nDone.");
