/**
 * Move a wrongly-assigned user (+ their accounts) from BLACKOS to OCEANAPROFX.
 * Usage: node scripts/heal-user-to-oceanaprofx.js anaskhany47@gmail.com
 */
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

const email = String(process.argv[2] || "")
  .trim()
  .toLowerCase();
if (!email) {
  console.error("Usage: node scripts/heal-user-to-oceanaprofx.js <email>");
  process.exit(1);
}

const OCEANA_BROKER_ID = new mongoose.Types.ObjectId("6addfa64c27bf05cb0606932");

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const user = await db.collection("users").findOne({ email });
if (!user) throw new Error(`User not found: ${email}`);

const before = String(user.brokerId || "");
await db.collection("users").updateOne(
  { _id: user._id },
  { $set: { brokerId: OCEANA_BROKER_ID } }
);

const accRes = await db.collection("accounts").updateMany(
  { user_id: user._id },
  { $set: { brokerId: OCEANA_BROKER_ID } }
);

console.log({
  email,
  userId: String(user._id),
  brokerIdBefore: before,
  brokerIdAfter: String(OCEANA_BROKER_ID),
  accountsUpdated: accRes.modifiedCount,
});

await mongoose.disconnect();
process.exit(0);
