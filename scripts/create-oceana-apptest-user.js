import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcrypt";

const uri = process.env.MONGO_URI;
await mongoose.connect(uri);
const db = mongoose.connection.db;
const brokerId = new mongoose.Types.ObjectId("6addfa64c27bf05cb0606932");
const email = "apptest@oceanaprofx.com";
const plain = "OceanaTest@123";

let user = await db.collection("users").findOne({ email });
if (!user) {
  const ins = await db.collection("users").insertOne({
    email,
    name: "Oceana App Test",
    phone: "",
    userType: "USER",
    platformRole: null,
    brokerId,
    isMailVerified: true,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  user = await db.collection("users").findOne({ _id: ins.insertedId });
  console.log("CREATED_USER", String(user._id));
} else {
  await db.collection("users").updateOne(
    { _id: user._id },
    { $set: { isMailVerified: true, brokerId } },
  );
  console.log("EXISTING_USER", String(user._id));
}

const hash = await bcrypt.hash(plain, 10);
const auth = await db.collection("auths").findOne({ user_id: user._id });
if (!auth) {
  await db.collection("auths").insertOne({
    user_id: user._id,
    password_hash: hash,
    login_attempts: 0,
    is_locked: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log("CREATED_AUTH");
} else {
  await db.collection("auths").updateOne(
    { _id: auth._id },
    { $set: { password_hash: hash, login_attempts: 0, is_locked: false } },
  );
  console.log("UPDATED_AUTH");
}

let account = await db.collection("accounts").findOne({
  user_id: user._id,
  status: "active",
});
if (!account) {
  let num = "9000001";
  while (await db.collection("accounts").findOne({ account_number: num })) {
    num = String(Number(num) + 1);
  }
  const accIns = await db.collection("accounts").insertOne({
    user_id: user._id,
    brokerId,
    account_number: num,
    account_type: "demo",
    plan_name: "Standard",
    leverage: 500,
    balance: 10000,
    equity: 10000,
    bonus_balance: 0,
    currency: "USD",
    status: "active",
    is_primary: true,
    spread_enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  account = await db.collection("accounts").findOne({ _id: accIns.insertedId });
  console.log("CREATED_ACCOUNT", account.account_number);
} else {
  console.log(
    "EXISTING_ACCOUNT",
    account.account_number,
    account.account_type,
  );
}

// Ensure exactly one primary for this user (email login opens it).
await db.collection("accounts").updateMany(
  { user_id: user._id },
  { $set: { is_primary: false } },
);
await db.collection("accounts").updateOne(
  { _id: account._id },
  { $set: { is_primary: true } },
);
account = await db.collection("accounts").findOne({ _id: account._id });
console.log("PRIMARY_ACCOUNT", account.account_number);

console.log(
  JSON.stringify({
    email,
    password: plain,
    account: account.account_number,
    verified: true,
  }),
);
await mongoose.disconnect();
