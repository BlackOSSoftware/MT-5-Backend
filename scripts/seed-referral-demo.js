/**
 * Seed demo referral network for testing the IB portal.
 * Creates users under the referral code owner (default 8UPT5U1O)
 * in a proper tree structure. No emails are sent. No payouts.
 *
 * Usage: node scripts/seed-referral-demo.js [REFERRAL_CODE]
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/database.js";
import User from "../src/models/User.model.js";
import Auth from "../src/models/Auth.model.js";
import Referral from "../src/models/Referral.model.js";
import { hashPassword } from "../src/utils/hash.util.js";
import { generateReferralCode } from "../src/utils/referralCode.util.js";

const REFERRAL_CODE = (process.argv[2] || "8UPT5U1O").trim().toUpperCase();
const DEMO_PASSWORD = "Demo@12345";

// Tree: root -> 6 direct clients -> nested clients under some of them
const TREE = [
  { name: "Aarav Sharma", email: "aarav.sharma@demo.oceanaprofx.com", children: [
    { name: "Meera Iyer", email: "meera.iyer@demo.oceanaprofx.com", children: [] },
    { name: "Rohan Verma", email: "rohan.verma@demo.oceanaprofx.com", children: [] },
  ]},
  { name: "Priya Nair", email: "priya.nair@demo.oceanaprofx.com", children: [
    { name: "Kabir Singh", email: "kabir.singh@demo.oceanaprofx.com", children: [] },
    { name: "Ananya Rao", email: "ananya.rao@demo.oceanaprofx.com", children: [] },
  ]},
  { name: "Vikram Patel", email: "vikram.patel@demo.oceanaprofx.com", children: [
    { name: "Sneha Kulkarni", email: "sneha.kulkarni@demo.oceanaprofx.com", children: [] },
  ]},
  { name: "Neha Gupta", email: "neha.gupta@demo.oceanaprofx.com", children: [
    { name: "Arjun Mehta", email: "arjun.mehta@demo.oceanaprofx.com", children: [] },
  ]},
  { name: "Sahil Khan", email: "sahil.khan@demo.oceanaprofx.com", children: [] },
  { name: "Divya Reddy", email: "divya.reddy@demo.oceanaprofx.com", children: [] },
];

async function createUser({ name, email, parentId, brokerId, passwordHash }) {
  const existing = await User.findOne({ email: email.toLowerCase() }).lean();
  if (existing) {
    console.log(`  skip (exists): ${email}`);
    return existing._id;
  }

  const user = await User.create({
    email: email.toLowerCase(),
    name,
    userType: "USER",
    isMailVerified: true,
    kycStatus: "VERIFIED",
    ...(brokerId ? { brokerId } : {}),
  });

  await Auth.create({
    user_id: user._id,
    password_hash: passwordHash,
    // no email verify token needed - already verified
  });

  await Referral.create({
    user_id: user._id,
    referral_code: generateReferralCode(),
    referred_by: parentId,
    status: "CONFIRMED",
  });

  console.log(`  created: ${name} <${email}>`);
  return user._id;
}

async function main() {
  await connectDB();

  const rootReferral = await Referral.findOne({ referral_code: REFERRAL_CODE }).lean();
  if (!rootReferral) {
    console.error(`Referral code ${REFERRAL_CODE} not found`);
    process.exit(1);
  }
  const rootUser = await User.findById(rootReferral.user_id).lean();
  if (!rootUser) {
    console.error("Root user not found");
    process.exit(1);
  }
  console.log(`Root IB: ${rootUser.name} <${rootUser.email}> (${REFERRAL_CODE})`);

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const brokerId = rootUser.brokerId || null;
  const rootId = rootUser._id;

  let created = 0;
  let skipped = 0;

  for (const node of TREE) {
    const before = created;
    const id = await createUser({
      name: node.name,
      email: node.email,
      parentId: rootId,
      brokerId,
      passwordHash,
    });
    if (id) created += 1;

    for (const child of node.children) {
      await createUser({
        name: child.name,
        email: child.email,
        parentId: id,
        brokerId,
        passwordHash,
      });
    }
    if (created === before) skipped += 1;
  }

  // Count network
  const direct = await Referral.countDocuments({ referred_by: rootId });
  const all = await Referral.find({ referred_by: rootId }).select("user_id").lean();
  const ids = new Set(all.map((r) => String(r.user_id)));
  // BFS for total network
  let frontier = [...ids];
  while (frontier.length) {
    const kids = await Referral.find({ referred_by: { $in: frontier.map((x) => new mongoose.Types.ObjectId(x)) } })
      .select("user_id")
      .lean();
    frontier = [];
    for (const k of kids) {
      const kid = String(k.user_id);
      if (!ids.has(kid)) {
        ids.add(kid);
        frontier.push(kid);
      }
    }
  }

  console.log(`\nDone. Direct clients: ${direct}, Total network: ${ids.size}`);
  console.log(`Demo password for all seeded users: ${DEMO_PASSWORD}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
