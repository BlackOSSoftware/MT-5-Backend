// Test IB commission withdrawal flow end-to-end (service level).
import "dotenv/config";
import mongoose from "mongoose";
import User from "../src/models/User.model.js";
import IbCommission from "../src/models/IbCommission.model.js";
import Withdrawal from "../src/models/Withdrawal.model.js";
import WalletTransaction from "../src/models/WalletTransaction.model.js";
import { withdrawIbCommissionService, getIbCommissionSummaryForIb } from "../src/services/ibCommission.service.js";

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

const user = await User.findOne({ email: "anaskhany47@gmail.com" }).lean();
console.log("user:", user.email, "kyc:", user.kycStatus, "wallet:", user.wallet_balance, "hold:", user.wallet_hold_balance);

const before = await getIbCommissionSummaryForIb(user._id);
console.log("commission before:", JSON.stringify(before));

const method = "UPI";
const payout = { upi_id: "ibtest@upi" };

try {
  const res = await withdrawIbCommissionService({
    userId: user._id,
    amount: 1,
    method,
    payout,
    ipAddress: "127.0.0.1",
  });
  console.log("withdraw result:", JSON.stringify(res.data?._id || res.message));
  console.log("commissionConverted:", res.data?.commissionConverted);
} catch (e) {
  console.log("withdraw FAILED:", e.message);
}

const after = await getIbCommissionSummaryForIb(user._id);
console.log("commission after:", JSON.stringify(after));

const u2 = await User.findById(user._id).select("wallet_balance wallet_hold_balance").lean();
console.log("wallet after: balance=", u2.wallet_balance, "hold=", u2.wallet_hold_balance);

const wt = await WalletTransaction.find({ user: user._id }).sort({ createdAt: -1 }).limit(2).lean();
console.log("wallet txns:", wt.map((t) => `${t.type} $${t.amount} ${t.remark}`).join(" | "));

const wd = await Withdrawal.find({ user: user._id }).sort({ createdAt: -1 }).limit(2).lean();
console.log("withdrawals:", wd.map((w) => `$${w.amount} ${w.status} src=${w.source}`).join(" | "));

await mongoose.disconnect();
console.log("Done.");
