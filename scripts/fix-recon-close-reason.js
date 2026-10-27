/**
 * Real engine closes use closeReason=MANUAL_CLOSE.
 * Recon import used MANUAL — some mobile clients only accept MANUAL_CLOSE
 * and drop/fail the whole history list when the enum does not match.
 */
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

const RECON_TAG = "RECON_HISTORY_4810033902";
const ACCOUNT_NUMBER = "4810033902";

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
const account = await db.collection("accounts").findOne({ account_number: ACCOUNT_NUMBER });
if (!account) throw new Error("account not found");

const before = await db.collection("trades").countDocuments({
  accountId: account._id,
  "metadata.reconTag": RECON_TAG,
  closeReason: "MANUAL",
});

const res = await db.collection("trades").updateMany(
  {
    accountId: account._id,
    "metadata.reconTag": RECON_TAG,
    closeReason: "MANUAL",
  },
  {
    $set: {
      closeReason: "MANUAL_CLOSE",
      "metadata.closeReasonFixed": true,
    },
  }
);

console.log({ matchedManual: before, modified: res.modifiedCount });

// Also ensure API-facing fields match live closes: ipAddress present, orderType MARKET
const sample = await db.collection("trades").findOne({
  accountId: account._id,
  "metadata.reconTag": RECON_TAG,
});
console.log("sample closeReason", sample?.closeReason);

await mongoose.disconnect();
process.exit(0);
