import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);

import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

import User from "../src/models/User.model.js";
import Auth from "../src/models/Auth.model.js";
import Referral from "../src/models/Referral.model.js";
import ReferralReward from "../src/models/ReferralReward.model.js";
import Account from "../src/models/Account.model.js";
import AccountPlan from "../src/models/AccountPlan.model.js";
import Brokerage from "../src/models/Brokerage.model.js";
import Kyc from "../src/models/Kyc.model.js";
import Deposit from "../src/models/Deposit.model.js";
import { hashPassword } from "../src/utils/hash.util.js";
import { generateReferralCode } from "../src/utils/referralCode.util.js";
import { createAccount } from "../src/services/account.service.js";
import { approveDepositService } from "../src/services/deposit.service.js";
import { createReferralRewardEligibility } from "../src/services/referral.service.js";

const ANAS_EMAIL = "anaskhany47@gmail.com";
const DEFAULT_PASSWORD = "Test@1234";
const PLACEHOLDER_IMG =
  "https://res.cloudinary.com/ds1mkqecg/image/upload/v1/seed/kyc-placeholder.jpg";

const DIRECT_NAMES = [
  "Ayaan Malik",
  "Zara Sheikh",
  "Omar Farooq",
  "Hina Rizvi",
  "Bilal Ahmed",
  "Sara Khan",
  "Imran Qureshi",
  "Nadia Hussain",
];

const NETWORK_TREE = [
  // under first direct (Ayaan)
  { parentIndex: 0, name: "Rehan Ali" },
  { parentIndex: 0, name: "Meher Noor" },
  // under second direct (Zara)
  { parentIndex: 1, name: "Kabir Shah" },
  { parentIndex: 1, name: "Lina Batool" },
  // under third direct (Omar)
  { parentIndex: 2, name: "Yusuf Raza" },
];

function slugEmail(name, i) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.|\.$/g, "");
  return `seed.${base}.${i}@oceanaprofx.test`;
}

function phoneFor(i) {
  return `9${String(7000000000 + i).slice(0, 10)}`;
}

async function ensureUser({
  name,
  email,
  phone,
  brokerId,
  referredBy,
}) {
  let user = await User.findOne({ email: email.toLowerCase() });
  if (user) {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          name,
          phone,
          brokerId,
          isMailVerified: true,
          kycStatus: "VERIFIED",
          userType: "USER",
        },
      },
    );
  } else {
    user = await User.create({
      email: email.toLowerCase(),
      phone,
      name,
      brokerId,
      userType: "USER",
      isMailVerified: true,
      kycStatus: "VERIFIED",
      signup_ip: "127.0.0.1",
    });
  }

  const passwordHash = await hashPassword(DEFAULT_PASSWORD);
  await Auth.findOneAndUpdate(
    { user_id: user._id },
    {
      $set: {
        password_hash: passwordHash,
        email_verify_token_hash: null,
        email_verify_token_expires_at: null,
      },
    },
    { upsert: true },
  );

  let referral = await Referral.findOne({ user_id: user._id });
  if (!referral) {
    referral = await Referral.create({
      user_id: user._id,
      referral_code: generateReferralCode(),
      referred_by: referredBy || null,
      status: "CONFIRMED",
    });
  } else {
    await Referral.updateOne(
      { _id: referral._id },
      {
        $set: {
          referred_by: referredBy || referral.referred_by || null,
          status: "CONFIRMED",
        },
      },
    );
    referral = await Referral.findById(referral._id);
  }

  await Kyc.findOneAndUpdate(
    { user: user._id },
    {
      $set: {
        brokerId,
        user: user._id,
        source: "ADMIN",
        documentType: "NIC",
        documents: {
          front: {
            image_url: PLACEHOLDER_IMG,
            image_public_id: "seed/kyc-front",
          },
          selfie: {
            image_url: PLACEHOLDER_IMG,
            image_public_id: "seed/kyc-selfie",
          },
        },
        status: "VERIFIED",
        rejectionReason: "",
      },
    },
    { upsert: true },
  );

  return { user, referral };
}

async function ensureLiveOceanaRaw({ userId, plan }) {
  let account = await Account.findOne({
    user_id: userId,
    account_type: "live",
    account_plan_id: plan._id,
    status: "active",
  });

  if (!account) {
    // Strong passwords required by createAccount
    const tradePass = "Trade@1234";
    const watchPass = "Watch@1234";
    const created = await createAccount({
      userId,
      account_plan_id: plan._id,
      account_type: "live",
      trade_password: tradePass,
      watch_password: watchPass,
    });
    account = await Account.findById(created.id || created._id);
  }

  // Ensure eligibility exists even if createAccount path already ran
  await createReferralRewardEligibility({
    referredUserId: userId,
    referredAccountId: account._id,
    planId: plan._id,
  });

  return account;
}

async function ensureApprovedDeposit({ userId, accountId, amount, adminId }) {
  let deposit = await Deposit.findOne({
    user: userId,
    account: accountId,
    status: "APPROVED",
  });

  if (deposit) return deposit;

  deposit = await Deposit.create({
    user: userId,
    account: accountId,
    amount,
    method: "MANUAL",
    proof: {
      image_url: PLACEHOLDER_IMG,
      image_public_id: "seed/deposit-proof",
    },
    status: "PENDING",
    ipAddress: "127.0.0.1",
  });

  try {
    await approveDepositService(String(deposit._id), String(adminId), null);
  } catch (err) {
    // If approve path fails (engine etc), force-approve lightly for seed
    console.warn("approveDepositService failed, force update:", err?.message || err);
    await Deposit.updateOne(
      { _id: deposit._id },
      {
        $set: {
          status: "APPROVED",
          actionAt: new Date(),
          actionBy: adminId,
        },
      },
    );
    await Account.updateOne(
      { _id: accountId },
      {
        $inc: { balance: amount, equity: amount },
        $set: { first_deposit: true },
      },
    );
  }

  return Deposit.findById(deposit._id);
}

async function bumpReferrerCounts(referrerUserId) {
  const directs = await Referral.countDocuments({ referred_by: referrerUserId });
  await Referral.updateOne(
    { user_id: referrerUserId },
    { $set: { total_referrals: directs, status: "CONFIRMED" } },
  );
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Mongo connected");

  const anas = await User.findOne({ email: ANAS_EMAIL });
  if (!anas) {
    throw new Error(`Referrer not found: ${ANAS_EMAIL}`);
  }

  let brokerId = anas.brokerId;
  if (!brokerId) {
    const broker = await Brokerage.findOne({
      $or: [{ code: /OCEANA/i }, { name: /oceana/i }],
    });
    if (!broker) throw new Error("Oceana broker not found");
    brokerId = broker._id;
    await User.updateOne({ _id: anas._id }, { $set: { brokerId } });
  }

  await User.updateOne(
    { _id: anas._id },
    { $set: { isMailVerified: true, kycStatus: "VERIFIED" } },
  );

  let anasRef = await Referral.findOne({ user_id: anas._id });
  if (!anasRef) {
    anasRef = await Referral.create({
      user_id: anas._id,
      referral_code: generateReferralCode(),
      referred_by: null,
      status: "CONFIRMED",
    });
  }

  const plan =
    (await AccountPlan.findOne({
      brokerId,
      isActive: true,
      is_demo_allowed: { $ne: true },
      name: /raw/i,
    })) ||
    (await AccountPlan.findOne({
      brokerId,
      isActive: true,
      is_demo_allowed: { $ne: true },
      referral_reward_amount: { $gt: 0 },
    }));

  if (!plan) throw new Error("Oceana Raw (or rewarded) plan not found");

  console.log("ANAS", {
    id: String(anas._id),
    email: anas.email,
    code: anasRef.referral_code,
    brokerId: String(brokerId),
  });
  console.log("PLAN", {
    id: String(plan._id),
    name: plan.name,
    reward: plan.referral_reward_amount,
    minDeposit: plan.minDeposit,
  });

  // Ensure Anas has a live account to receive payouts
  await ensureLiveOceanaRaw({ userId: anas._id, plan });

  const directs = [];
  for (let i = 0; i < DIRECT_NAMES.length; i++) {
    const name = DIRECT_NAMES[i];
    const email = slugEmail(name, i + 1);
    const { user, referral } = await ensureUser({
      name,
      email,
      phone: phoneFor(i + 1),
      brokerId,
      referredBy: anas._id,
    });
    const account = await ensureLiveOceanaRaw({ userId: user._id, plan });
    const depositAmount = Math.max(Number(plan.minDeposit || 50), 100 + i * 25);
    await ensureApprovedDeposit({
      userId: user._id,
      accountId: account._id,
      amount: depositAmount,
      adminId: anas._id,
    });
    directs.push({ user, referral, account, email, name });
    console.log(`DIRECT OK: ${name} <${email}> acc=${account.account_number}`);
  }

  for (let i = 0; i < NETWORK_TREE.length; i++) {
    const node = NETWORK_TREE[i];
    const parent = directs[node.parentIndex];
    if (!parent) continue;
    const name = node.name;
    const email = slugEmail(name, 100 + i);
    const { user } = await ensureUser({
      name,
      email,
      phone: phoneFor(100 + i),
      brokerId,
      referredBy: parent.user._id,
    });
    const account = await ensureLiveOceanaRaw({ userId: user._id, plan });
    const depositAmount = Math.max(Number(plan.minDeposit || 50), 150 + i * 20);
    await ensureApprovedDeposit({
      userId: user._id,
      accountId: account._id,
      amount: depositAmount,
      adminId: anas._id,
    });
    console.log(
      `NETWORK OK: ${name} <${email}> under ${parent.name} acc=${account.account_number}`,
    );
  }

  // Refresh total_referrals for Anas + directs
  await bumpReferrerCounts(anas._id);
  for (const d of directs) {
    await bumpReferrerCounts(d.user._id);
  }

  const rewards = await ReferralReward.find({ referrer_user: anas._id }).lean();
  const eligible = rewards.filter((r) => r.status === "ELIGIBLE");
  const approved = rewards.filter((r) => r.status === "APPROVED");

  console.log("\n=== SUMMARY ===");
  console.log("Direct referrals:", directs.length);
  console.log("Network nodes:", NETWORK_TREE.length);
  console.log("Anas rewards total:", rewards.length);
  console.log(
    "Anas ELIGIBLE $",
    eligible.reduce((s, r) => s + Number(r.reward_amount || 0), 0),
  );
  console.log(
    "Anas APPROVED $",
    approved.reduce((s, r) => s + Number(r.reward_amount || 0), 0),
  );
  console.log("Password for all seeded users:", DEFAULT_PASSWORD);

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
