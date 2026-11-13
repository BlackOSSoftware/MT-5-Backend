// E2E IB hierarchy setup:
//   L0 anaskhany47 -> L1 onlymoviesy047 -> L2 codexnewcodi -> L3 ib.tree.l3@test.local
// Creates L3 user + referral link, live trading account, AccountAuth, APPROVED deposits.
import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.model.js";
import Referral from "../src/models/Referral.model.js";
import Account from "../src/models/Account.model.js";
import AccountAuth from "../src/models/AccountAuth.model.js";
import AccountPlan from "../src/models/AccountPlan.model.js";
import Deposit from "../src/models/Deposit.model.js";
import { hashPassword } from "../src/utils/hash.util.js";

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

const EMAILS = {
  l0: "anaskhany47@gmail.com",
  l1: "onlymoviesy047@gmail.com",
  l2: "codexnewcodi@gmail.com",
  l3: "ib.tree.l3@test.local",
};

const users = {};
for (const [k, email] of Object.entries(EMAILS)) {
  users[k] = await User.findOne({ email }).lean();
  console.log(k, email, users[k]?._id || "MISSING");
}
if (!users.l0 || !users.l1 || !users.l2) throw new Error("Chain users missing");

// ---- L3 user ----
let l3 = users.l3;
if (!l3) {
  l3 = await User.create({
    email: EMAILS.l3,
    name: "IB Tree Level3",
    userType: "USER",
    brokerId: users.l2.brokerId || null,
    isMailVerified: true,
    kycStatus: "VERIFIED",
    ibDashboardEnabled: true,
  });
  console.log("created L3 user", l3._id);
} else {
  console.log("L3 user exists", l3._id);
}
users.l3 = l3;

// ---- Referral links ----
const links = [
  [users.l1._id, users.l0._id],
  [users.l2._id, users.l1._id],
  [users.l3._id, users.l2._id],
];
for (const [uid, pid] of links) {
  const exists = await Referral.findOne({ user_id: uid }).lean();
  if (exists) {
    if (String(exists.referred_by) !== String(pid)) {
      await Referral.updateOne({ _id: exists._id }, { $set: { referred_by: pid } });
      console.log(`referral fixed ${uid} -> ${pid}`);
    } else {
      console.log(`referral ok ${uid} -> ${pid}`);
    }
  } else {
    await Referral.create({
      user_id: uid,
      referred_by: pid,
      referral_code: `IBT${String(uid).slice(-8).toUpperCase()}`,
      total_referrals: 0,
      status: "CONFIRMED",
    });
    console.log(`referral created ${uid} -> ${pid}`);
  }
}

// ---- Trading accounts for L1, L2, L3 ----
const corePlan = await AccountPlan.findOne({ name: "CORE" }).lean();
if (!corePlan) throw new Error("CORE plan missing");

const template = await Account.findOne({
  user_id: users.l2._id,
  account_type: "live",
}).lean();
if (!template) throw new Error("L2 template account missing");
console.log("template account:", template.account_number, template.plan_name);

async function ensureLiveAccount(user, label) {
  let acc = await Account.findOne({ user_id: user._id, account_type: "live", status: "active" }).lean();
  if (acc) {
    console.log(`${label} account exists:`, acc.account_number, "bal=", acc.balance);
    return acc;
  }
  const account_number = String(Math.floor(1000000000 + Math.random() * 8999999999));
  acc = await Account.create({
    user_id: user._id,
    brokerId: template.brokerId || user.brokerId || null,
    account_plan_id: corePlan._id,
    account_number,
    account_type: "live",
    plan_name: "CORE",
    leverage: template.leverage,
    spread_enabled: true,
    commission_per_lot: template.commission_per_lot ?? 0,
    swap_enabled: template.swap_enabled ?? true,
    swap_charge: template.swap_charge ?? 0,
    currency: template.currency || "USD",
    balance: 0,
    equity: 0,
    status: "active",
    is_primary: true,
    first_deposit: false,
  });
  console.log(`${label} account created:`, acc.account_number, acc._id);
  return acc;
}

const accs = {};
accs.l1 = await Account.findOne({ user_id: users.l1._id, account_type: "live", status: "active" }).lean();
accs.l2 = template;
accs.l3 = await ensureLiveAccount(users.l3, "L3");
if (!accs.l1) throw new Error("L1 live account missing");

// ---- AccountAuth for each trading account (needed by accountAuthMiddleware) ----
const pwHash = await hashPassword("Test@123");
for (const [k, acc] of Object.entries(accs)) {
  const existing = await AccountAuth.findOne({ account_id: acc._id }).lean();
  if (existing) {
    console.log(`AccountAuth ok ${k}:`, acc.account_number);
    continue;
  }
  await AccountAuth.create({
    account_id: acc._id,
    account_number: acc.account_number,
    trade_password_hash: pwHash,
    watch_password_hash: pwHash,
    credentials_created_at: new Date(),
  });
  console.log(`AccountAuth created ${k}:`, acc.account_number);
}

// ---- APPROVED deposits $500 each + balance credit ----
for (const [k, acc] of Object.entries(accs)) {
  const user = users[k];
  const depExists = await Deposit.findOne({
    account: acc._id,
    status: "APPROVED",
    amount: 500,
  }).lean();
  if (!depExists) {
    await Deposit.create({
      user: user._id,
      account: acc._id,
      brokerId: acc.brokerId || null,
      amount: 500,
      method: "MANUAL",
      status: "APPROVED",
      bonus_percent: 0,
      bonus_amount: 0,
      actionAt: new Date(),
      ipAddress: "127.0.0.1",
    });
    console.log(`deposit APPROVED ${k}: $500 -> ${acc.account_number}`);
  } else {
    console.log(`deposit exists ${k}`);
  }

  // Top-up balance to at least $500 (idempotent-ish: set to max(current,500))
  const fresh = await Account.findById(acc._id).lean();
  if (Number(fresh.balance) < 500) {
    const newBal = 500;
    await Account.updateOne(
      { _id: acc._id },
      {
        $set: {
          balance: newBal,
          equity: newBal + Number(fresh.bonus_balance || 0),
          first_deposit: true,
        },
      },
    );
    console.log(`balance set ${k}: ${fresh.balance} -> ${newBal}`);
  } else {
    console.log(`balance ok ${k}: ${fresh.balance}`);
  }
}

console.log("\n== SUMMARY ==");
for (const [k, u] of Object.entries(users)) {
  const acc = await Account.findOne({ user_id: u._id, account_type: "live", status: "active" }).lean();
  console.log(`${k} ${u.email} user=${u._id} account=${acc?.account_number} bal=${acc?.balance}`);
}

await mongoose.disconnect();
console.log("\nDone. Next: restart backend so engine loads accounts, then run ib-e2e-trade.js");
