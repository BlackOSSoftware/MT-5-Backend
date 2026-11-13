// E2E trade + commission verification.
// Places real market orders via HTTP API for L1/L2/L3 traders,
// then verifies IbCommission distribution per level.
import "dotenv/config";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import Account from "../src/models/Account.model.js";
import User from "../src/models/User.model.js";
import IbCommission from "../src/models/IbCommission.model.js";
import Trade from "../src/models/Trade.model.js";
import { getIbCommissionSummaryForIb } from "../src/services/ibCommission.service.js";

const API = process.env.API_BASE || "http://localhost:4000/api";
const SECRET = process.env.ACCOUNT_JWT_SECRET;

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
for (const [k, e] of Object.entries(EMAILS)) {
  users[k] = await User.findOne({ email: e }).lean();
}

const accs = {};
for (const k of ["l1", "l2", "l3"]) {
  accs[k] = await Account.findOne({
    user_id: users[k]._id,
    account_type: "live",
    status: "active",
  }).lean();
}

function accountToken(acc, user) {
  return jwt.sign(
    {
      accountId: String(acc._id),
      userId: String(user._id),
      sessionType: "TRADE",
    },
    SECRET,
    { expiresIn: "15m" },
  );
}

async function placeTrade(k, side = "BUY", volume = 0.01) {
  const acc = accs[k];
  const user = users[k];
  const token = accountToken(acc, user);
  const res = await fetch(`${API}/v1/trade/market`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ symbol: "XAUUSD", side, volume }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(
    `[${k}] ${side} ${volume} XAUUSD -> HTTP ${res.status}`,
    body?.data?.positionId || body?.message || "",
  );
  return body;
}

// ---- Place trades: L2 trader, L1 trader, L3 trader ----
console.log("\n== PLACING TRADES ==");
await placeTrade("l2");
await new Promise((r) => setTimeout(r, 800));
await placeTrade("l1");
await new Promise((r) => setTimeout(r, 800));
await placeTrade("l3");

// creditIbOnFill is async (setImmediate) — wait then verify
await new Promise((r) => setTimeout(r, 3000));

// ---- Verify: latest commission rows per trader ----
console.log("\n== LATEST IB COMMISSION ROWS ==");
const latest = await IbCommission.find({})
  .sort({ createdAt: -1 })
  .limit(12)
  .populate("ib_user_id", "name email")
  .populate("trader_user_id", "name email")
  .lean();

const nameOf = (id) => {
  for (const u of Object.values(users)) if (String(u._id) === String(id)) return u.email;
  return String(id);
};

for (const c of latest) {
  console.log(
    `trade=${c.trade_id.slice(0, 8)}… trader=${nameOf(c.trader_user_id?._id || c.trader_user_id)} ` +
      `ib=${c.ib_user_id?.email || nameOf(c.ib_user_id)} L${c.level} ` +
      `${c.symbol} lots=${c.lots} ib$/lot=${c.ib_usd_per_lot} amt=$${c.amount} ${c.status}`,
  );
}

// ---- Per-trade distribution check for the 3 new trades ----
console.log("\n== PER-TRADE DISTRIBUTION ==");
const newTrades = await Trade.find({ symbol: "XAUUSD", status: "OPEN" })
  .sort({ openTime: -1 })
  .limit(3)
  .lean();

for (const t of newTrades) {
  const rows = await IbCommission.find({ trade_id: String(t.positionId) }).lean();
  const trader = await User.findById(t.userId).select("email").lean();
  console.log(`\nTrade ${t.positionId} trader=${trader?.email} vol=${t.volume}`);
  if (!rows.length) {
    console.log("  NO COMMISSION ROWS!");
    continue;
  }
  let total = 0;
  for (const r of rows.sort((a, b) => a.level - b.level)) {
    total += r.amount;
    const ib = await User.findById(r.ib_user_id).select("email").lean();
    console.log(`  L${r.level} -> ${ib?.email} : $${r.amount} (${r.percent}%)`);
  }
  const budget = rows[0].ib_usd_per_lot * t.volume;
  console.log(`  total paid=$${total.toFixed(4)} budget=$${budget.toFixed(4)} ${total <= budget + 0.0001 ? "OK" : "OVER BUDGET!"}`);
}

// ---- Summary per IB ----
console.log("\n== IB COMMISSION SUMMARY ==");
for (const k of ["l0", "l1", "l2", "l3"]) {
  const s = await getIbCommissionSummaryForIb(users[k]._id);
  console.log(
    `${k} ${users[k].email}: total=$${s.totalEarned} available=$${s.available} paid=$${s.paidOut} rows=${s.counts.total}`,
  );
}

await mongoose.disconnect();
console.log("\nDone.");
