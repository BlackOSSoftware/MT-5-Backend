import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";
import { getPositionsService } from "../src/services/tradeOrder.service.js";
import { getDealsService, getOrdersService } from "../src/services/history.service.js";

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const target = await db.collection("accounts").findOne({ account_number: "4810033902" });

// Find another live account that has closed trades (not recon)
const otherTrade = await db.collection("trades").findOne({
  status: "CLOSED",
  accountId: { $ne: target._id },
  "metadata.reconTag": { $exists: false },
});
const other = otherTrade
  ? await db.collection("accounts").findOne({ _id: otherTrade.accountId })
  : null;

function summarize(label, positions) {
  const sample = positions[0] || null;
  const keys = sample ? Object.keys(sample).sort() : [];
  const nullish = sample
    ? Object.fromEntries(
        Object.entries(sample).filter(([, v]) => v == null)
      )
    : {};
  const types = sample
    ? Object.fromEntries(
        Object.entries(sample).map(([k, v]) => [k, v === null ? "null" : typeof v])
      )
    : {};
  console.log("\n====", label, "====");
  console.log("count", positions.length);
  console.log("keys", keys);
  console.log("nullish", nullish);
  console.log("types", types);
  console.log("sample", sample);
}

const targetPos = await getPositionsService({
  accountId: String(target._id),
  page: 1,
  limit: 5,
});
summarize(`TARGET ${target.account_number}`, targetPos.positions);

if (other) {
  const otherPos = await getPositionsService({
    accountId: String(other._id),
    page: 1,
    limit: 5,
  });
  summarize(`OTHER ${other.account_number}`, otherPos.positions);
}

// Compare raw trade docs
const rawTarget = await db.collection("trades").findOne({
  accountId: target._id,
  status: "CLOSED",
});
const rawOther = otherTrade;
console.log("\nRAW target keys", Object.keys(rawTarget || {}).sort());
console.log("RAW other keys", Object.keys(rawOther || {}).sort());
console.log("RAW target missing vs other", {
  targetOnly: Object.keys(rawTarget || {}).filter((k) => !(k in (rawOther || {}))),
  otherOnly: Object.keys(rawOther || {}).filter((k) => !(k in (rawTarget || {}))),
});
console.log("ticket sizes", {
  target: rawTarget?.ticket,
  other: rawOther?.ticket,
  targetClose: rawTarget?.closeTicket,
});

const deals = await getDealsService({ accountId: String(target._id), page: 1, limit: 3 });
console.log("\nDEALS sample", deals.deals?.[0]);
const orders = await getOrdersService({ accountId: String(target._id), page: 1, limit: 3 });
console.log("ORDERS sample", orders.orders?.[0]);

await mongoose.disconnect();
process.exit(0);
