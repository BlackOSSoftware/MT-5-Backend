import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}

const email = "apptest@oceanaprofx.com";

await mongoose.connect(uri);
const db = mongoose.connection.db;

const user = await db.collection("users").findOne({ email });
if (!user) {
  console.error("USER_NOT_FOUND", email);
  await mongoose.disconnect();
  process.exit(1);
}

console.log("USER", String(user._id), email);

const portalAuth = await db.collection("auths").updateOne(
  { user_id: user._id },
  {
    $set: {
      refresh_token_hash: null,
      refresh_token_expires_at: null,
      refresh_token_ip: null,
      refresh_token_device: null,
      updatedAt: new Date(),
    },
  },
);
console.log("PORTAL_AUTH_CLEARED", portalAuth.modifiedCount);

const accounts = await db
  .collection("accounts")
  .find({ user_id: user._id })
  .project({ _id: 1, account_number: 1 })
  .toArray();

const accountIds = accounts.map((a) => a._id);
console.log(
  "ACCOUNTS",
  accounts.map((a) => a.account_number).join(", ") || "(none)",
);

if (accountIds.length) {
  const now = new Date();
  const tradeAuth = await db.collection("accountauths").updateMany(
    { account_id: { $in: accountIds } },
    {
      $set: {
        access_token_hash: null,
        access_token_expires_at: null,
        refresh_token_hash: null,
        refresh_token_expires_at: null,
        // Invalidate any still-unexpired JWTs (middleware checks iat).
        credentials_last_reset_at: now,
        updatedAt: now,
      },
    },
  );
  console.log("TRADE_AUTH_CLEARED", tradeAuth.modifiedCount, "at", now.toISOString());
} else {
  console.log("TRADE_AUTH_CLEARED", 0);
}

console.log("DONE — apptest tokens revoked; app should hit Login on next API call");
await mongoose.disconnect();
