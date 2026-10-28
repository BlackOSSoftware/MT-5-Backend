/**
 * Ensure anaskhany47@gmail.com is on OCEANAPROFX and send verification mail
 * via Oceana SMTP (not FPTrade).
 */
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";
import { randomToken, sha256, hashPassword } from "../src/utils/hash.util.js";
import {
  sendEmailVerificationMail,
  resolveBrokerCode,
  getFrontendUrlForBroker,
} from "../src/utils/mail.util.js";

const EMAIL = "anaskhany47@gmail.com";
const OCEANA_BROKER_ID = "6addfa64c27bf05cb0606932";
const OCEANA_CODE = "OCEANAPROFX";

function dumpSmtpEnv() {
  console.log("SMTP ENV CHECK", {
    defaultUser: process.env.SMTP_USER,
    defaultFrom: process.env.SMTP_FROM,
    oceanaUser: process.env.SMTP_OCEANAPROFX_USER,
    oceanaFrom: process.env.SMTP_OCEANAPROFX_FROM,
    oceanaPassSet: Boolean(String(process.env.SMTP_OCEANAPROFX_PASS || "").trim()),
    oceanaHost: process.env.SMTP_OCEANAPROFX_HOST,
  });
}

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;
dumpSmtpEnv();

let user = await db.collection("users").findOne({ email: EMAIL });
if (!user) {
  console.log("Creating user...");
  const ins = await db.collection("users").insertOne({
    email: EMAIL,
    phone: "9999999999",
    name: "Anas Khan",
    userType: "USER",
    isMailVerified: false,
    brokerId: new mongoose.Types.ObjectId(OCEANA_BROKER_ID),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  user = await db.collection("users").findOne({ _id: ins.insertedId });
  const passwordHash = await hashPassword("Test@12345");
  await db.collection("auths").insertOne({
    user_id: user._id,
    password_hash: passwordHash,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log("User created", String(user._id));
} else {
  await db.collection("users").updateOne(
    { _id: user._id },
    {
      $set: {
        brokerId: new mongoose.Types.ObjectId(OCEANA_BROKER_ID),
        isMailVerified: false,
        updatedAt: new Date(),
      },
    }
  );
  user = await db.collection("users").findOne({ _id: user._id });
  console.log("User exists, forced brokerId=OCEANAPROFX", String(user._id));
}

const code = await resolveBrokerCode({ brokerId: user.brokerId });
console.log("Resolved broker code:", code);
if (code !== OCEANA_CODE) {
  throw new Error(`Expected ${OCEANA_CODE}, got ${code}`);
}

const token = randomToken();
const auth = await db.collection("auths").findOne({ user_id: user._id });
if (!auth) throw new Error("Auth record missing");
await db.collection("auths").updateOne(
  { _id: auth._id },
  {
    $set: {
      email_verify_token_hash: sha256(token),
      email_verify_token_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  }
);

const frontend = getFrontendUrlForBroker(code) || process.env.FRONTEND_URL;
const link = `${frontend}/verify-email?token=${token}`;
console.log("Sending verification to", EMAIL, "link host", frontend);

try {
  const info = await sendEmailVerificationMail(EMAIL, link, {
    brokerCode: code,
  });
  console.log("SEND OK", {
    messageId: info?.messageId,
    accepted: info?.accepted,
    rejected: info?.rejected,
    response: info?.response,
    envelope: info?.envelope,
  });
} catch (err) {
  console.error("SEND FAIL", err?.message || err);
  process.exitCode = 1;
}

await mongoose.disconnect();
process.exit(process.exitCode || 0);
