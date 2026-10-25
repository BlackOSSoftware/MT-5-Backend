/**
 * Seeds 10 real-looking users + Standard live accounts + first deposits
 * so referral earnings become ELIGIBLE / APPROVED for the network report.
 *
 * Tree:
 *   Rahul Sharma
 *   ├─ Priya Patel
 *   │  ├─ Arjun Mehta → Kabir Singh
 *   │  └─ Neha Gupta → Ananya Iyer
 *   └─ Vikram Reddy
 *      ├─ Sneha Nair → Rohan Das
 *      └─ Aditya Joshi
 *
 * Run: node scripts/seedReferralNetworkUsers.mjs
 */
import "dotenv/config";
import dns from "node:dns";
import mongoose from "mongoose";
import User from "../src/models/User.model.js";
import Auth from "../src/models/Auth.model.js";
import Referral from "../src/models/Referral.model.js";
import ReferralReward from "../src/models/ReferralReward.model.js";
import Account from "../src/models/Account.model.js";
import AccountAuth from "../src/models/AccountAuth.model.js";
import AccountPlan from "../src/models/AccountPlan.model.js";
import UserProfile from "../src/models/UserProfile.model.js";
import Deposit from "../src/models/Deposit.model.js";
import Transaction from "../src/models/Transaction.model.js";
import { hashPassword } from "../src/utils/hash.util.js";
import { generateReferralCode } from "../src/utils/referralCode.util.js";
import {
  generateAccountNumber,
  generateStrongPassword,
} from "../src/utils/accountNumber.util.js";
import { adminCreateDepositService } from "../src/services/deposit.service.js";
import {
  adminApproveReferralRewardService,
  requestReferralRewardService,
} from "../src/services/referral.service.js";
import {
  adminGetReferralTreeService,
  adminListReferralLinksService,
  adminListReferralNetworkService,
  adminReferralNetworkSummaryService,
} from "../src/services/referralReport.service.js";

const PASSWORD = "Test@12345";
const REWARD_AMOUNT = 25; // USD per first deposit of a referred user
const DEPOSIT_AMOUNT = 500;

const TREE = [
  {
    key: "U01",
    parent: null,
    name: "Rahul Sharma",
    email: "rahul.sharma.trades@gmail.com",
    phone: "+919811100001",
  },
  {
    key: "U02",
    parent: "U01",
    name: "Priya Patel",
    email: "priya.patel.fx@gmail.com",
    phone: "+919811100002",
  },
  {
    key: "U03",
    parent: "U01",
    name: "Vikram Reddy",
    email: "vikram.reddy.mt5@gmail.com",
    phone: "+919811100003",
  },
  {
    key: "U04",
    parent: "U02",
    name: "Arjun Mehta",
    email: "arjun.mehta.live@gmail.com",
    phone: "+919811100004",
  },
  {
    key: "U05",
    parent: "U02",
    name: "Neha Gupta",
    email: "neha.gupta.trade@gmail.com",
    phone: "+919811100005",
  },
  {
    key: "U06",
    parent: "U03",
    name: "Sneha Nair",
    email: "sneha.nair.fx@gmail.com",
    phone: "+919811100006",
  },
  {
    key: "U07",
    parent: "U03",
    name: "Aditya Joshi",
    email: "aditya.joshi.mt@gmail.com",
    phone: "+919811100007",
  },
  {
    key: "U08",
    parent: "U04",
    name: "Kabir Singh",
    email: "kabir.singh.trades@gmail.com",
    phone: "+919811100008",
  },
  {
    key: "U09",
    parent: "U05",
    name: "Ananya Iyer",
    email: "ananya.iyer.fx@gmail.com",
    phone: "+919811100009",
  },
  {
    key: "U10",
    parent: "U06",
    name: "Rohan Das",
    email: "rohan.das.live@gmail.com",
    phone: "+919811100010",
  },
];

function configureDns() {
  const configured = process.env.DNS_SERVERS;
  const current = dns.getServers();
  const onlyLoopback =
    current.length > 0 &&
    current.every((s) => s === "127.0.0.1" || s === "::1");
  const servers = (configured || (onlyLoopback ? "8.8.8.8,1.1.1.1" : ""))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) dns.setServers(servers);
}

async function cleanupOldSeedUsers() {
  const emails = [
    ...TREE.map((t) => t.email.toLowerCase()),
    // previous synthetic seeds
  ];
  const oldPattern = await User.find({
    $or: [
      { email: { $in: emails } },
      { email: { $regex: /^refseed\./i } },
    ],
  })
    .select("_id email")
    .lean();

  if (!oldPattern.length) return;

  const ids = oldPattern.map((u) => u._id);
  const accounts = await Account.find({ user_id: { $in: ids } })
    .select("_id")
    .lean();
  const accountIds = accounts.map((a) => a._id);

  await Promise.all([
    ReferralReward.deleteMany({
      $or: [
        { referred_user: { $in: ids } },
        { referrer_user: { $in: ids } },
      ],
    }),
    Referral.deleteMany({ user_id: { $in: ids } }),
    Auth.deleteMany({ user_id: { $in: ids } }),
    UserProfile.deleteMany({ user_id: { $in: ids } }),
    Deposit.deleteMany({ user: { $in: ids } }),
    Transaction.deleteMany({ user: { $in: ids } }),
    AccountAuth.deleteMany({ account_id: { $in: accountIds } }),
    Account.deleteMany({ _id: { $in: accountIds } }),
    User.deleteMany({ _id: { $in: ids } }),
  ]);

  console.log(`Cleaned ${oldPattern.length} previous seed users.`);
}

async function resolveStandardPlan() {
  const plans = await AccountPlan.find({ isActive: true }).lean();
  const livePlans = plans.filter((p) => p.is_demo_allowed !== true);
  let plan =
    livePlans.find((p) =>
      String(p.name || "").toUpperCase().includes("STANDARD"),
    ) ||
    livePlans[0] ||
    plans[0];

  if (!plan) throw new Error("No active account plan found.");

  // Ensure positive referral reward so eligibility is created.
  if (!(Number(plan.referral_reward_amount) > 0)) {
    await AccountPlan.updateOne(
      { _id: plan._id },
      { $set: { referral_reward_amount: REWARD_AMOUNT } },
    );
    plan = await AccountPlan.findById(plan._id).lean();
    console.log(
      `Updated plan "${plan.name}" referral_reward_amount → ${REWARD_AMOUNT}`,
    );
  }

  return plan;
}

async function createLiveStandardAccount(userId, plan) {
  const existing = await Account.findOne({
    user_id: userId,
    account_type: "live",
  }).lean();
  if (existing) {
    await Account.updateOne(
      { _id: existing._id },
      {
        $set: {
          first_deposit: false,
          account_plan_id: plan._id,
          plan_name: plan.name,
        },
      },
    );
    return {
      account: await Account.findById(existing._id).lean(),
      created: false,
    };
  }

  const leverage =
    typeof plan.max_leverage === "number" && plan.max_leverage > 0
      ? plan.max_leverage
      : 2000;

  const accountNumber = generateAccountNumber();
  const tradePass = generateStrongPassword(12);
  let watchPass = generateStrongPassword(12);
  while (watchPass === tradePass) watchPass = generateStrongPassword(12);

  const account = await Account.create({
    user_id: userId,
    account_plan_id: plan._id,
    account_number: accountNumber,
    account_type: "live",
    plan_name: plan.name,
    leverage,
    spread_enabled:
      typeof plan.spread_enabled === "boolean" ? plan.spread_enabled : true,
    spread_pips: typeof plan.spreadPips === "number" ? plan.spreadPips : 0,
    commission_per_lot:
      typeof plan.commission_per_lot === "number" ? plan.commission_per_lot : 0,
    swap_enabled:
      typeof plan.swap_enabled === "boolean" ? plan.swap_enabled : true,
    swap_charge:
      typeof plan.swap_charge === "number" ? Math.abs(plan.swap_charge) : 0,
    balance: 0,
    equity: 0,
    currency: plan.currency || "USD",
    status: "active",
    first_deposit: false,
  });

  await AccountAuth.create({
    account_id: account._id,
    account_number: account.account_number,
    trade_password_hash: await hashPassword(tradePass),
    watch_password_hash: await hashPassword(watchPass),
    login_attempts: 0,
    is_locked: false,
    credentials_created_at: new Date(),
  });

  return { account: account.toObject(), created: true, tradePass };
}

async function main() {
  configureDns();
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI missing");

  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB");

  await cleanupOldSeedUsers();

  const plan = await resolveStandardPlan();
  console.log(
    `Plan: ${plan.name} | referral_reward_amount=${plan.referral_reward_amount}`,
  );

  const admin =
    (await User.findOne({ userType: "ADMIN" }).select("_id email").lean()) ||
    null;
  if (!admin) throw new Error("No ADMIN user found for deposit approval actor");

  const passwordHash = await hashPassword(PASSWORD);
  const created = new Map();

  for (const node of TREE) {
    const email = node.email.toLowerCase();
    const user = await User.create({
      email,
      phone: node.phone,
      name: node.name,
      userType: "USER",
      isMailVerified: true,
      kycStatus: "VERIFIED",
      signup_ip: "127.0.0.1",
    });

    await Auth.create({
      user_id: user._id,
      password_hash: passwordHash,
      login_attempts: 0,
    });

    const parent = node.parent ? created.get(node.parent) : null;
    const referredBy = parent?.userId || null;

    const referral = await Referral.create({
      user_id: user._id,
      referral_code: generateReferralCode(),
      referred_by: referredBy,
      status: referredBy ? "PENDING" : "CONFIRMED",
      total_referrals: 0,
      total_earned: 0,
      referral_balance: 0,
    });

    await UserProfile.create({
      user_id: user._id,
      date_of_birth: null,
      gender: null,
      address_line_1: "12 MG Road",
      city: "Mumbai",
      state: "MH",
      country: "IN",
      pincode: "400001",
    });

    const { account } = await createLiveStandardAccount(user._id, plan);

    created.set(node.key, {
      key: node.key,
      parent: node.parent,
      userId: String(user._id),
      name: node.name,
      email,
      phone: node.phone,
      referralCode: referral.referral_code,
      referredByCode: parent?.referralCode || null,
      accountId: String(account._id),
      accountNumber: account.account_number,
    });

    console.log(
      `✓ ${node.name} <${email}> code=${referral.referral_code}` +
        (parent ? ` ← ${parent.name}` : " (root)") +
        ` | live ${account.account_number}`,
    );
  }

  // First deposit on every REFERRED user's live account → ELIGIBLE rewards
  console.log("\n--- First deposits on referred accounts ---");
  for (const row of created.values()) {
    if (!row.parent) continue;
    await adminCreateDepositService({
      accountId: row.accountId,
      amount: DEPOSIT_AMOUNT,
      method: "MANUAL",
      proof: { image_url: "", image_public_id: "" },
      adminId: admin._id,
      ipAddress: "127.0.0.1",
    });
    console.log(
      `  Deposited $${DEPOSIT_AMOUNT} → ${row.name} (${row.accountNumber})`,
    );
  }

  // Request + approve all ELIGIBLE rewards so referrers show earnings
  console.log("\n--- Approving referral rewards ---");
  const eligible = await ReferralReward.find({ status: "ELIGIBLE" })
    .select("_id referrer_user reward_amount")
    .lean();

  for (const reward of eligible) {
    const referrerId = String(reward.referrer_user);
    const referrerRow = [...created.values()].find(
      (r) => r.userId === referrerId,
    );
    if (!referrerRow) continue;

    await requestReferralRewardService({
      userId: referrerId,
      rewardId: String(reward._id),
      accountId: referrerRow.accountId,
    });

    await adminApproveReferralRewardService({
      adminId: admin._id,
      rewardId: String(reward._id),
    });

    console.log(
      `  Approved $${reward.reward_amount} → ${referrerRow.name}`,
    );
  }

  const rootId = created.get("U01").userId;
  const summary = await adminReferralNetworkSummaryService();
  const network = await adminListReferralNetworkService({
    q: "gmail.com",
    page: 1,
    limit: 20,
    onlyReferrers: true,
  });
  const links = await adminListReferralLinksService({
    q: "gmail.com",
    page: 1,
    limit: 50,
  });
  const tree = await adminGetReferralTreeService(rootId, { maxDepth: 8 });

  // Filter network to our 10 for display
  const seedIds = new Set([...created.values()].map((r) => r.userId));
  const seedNetwork = network.items.filter((i) => seedIds.has(i.userId));

  console.log("\n========== USERS ==========");
  console.log(`Portal password (all): ${PASSWORD}`);
  for (const row of created.values()) {
    console.log(
      `  ${row.name.padEnd(14)} ${row.email.padEnd(32)} code=${row.referralCode}` +
        (row.referredByCode ? ` via ${row.referredByCode}` : "") +
        ` | acct ${row.accountNumber}`,
    );
  }

  console.log("\n========== REPORT ==========");
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    `Rahul Sharma → direct ${tree.stats.directReferrals}, network ${tree.stats.networkSize}, levels`,
    tree.stats.levelBreakdown,
  );
  console.log(
    "Referrer earnings:",
    seedNetwork.map(
      (i) =>
        `${i.user?.name}: D${i.directReferrals}/N${i.networkSize} earned=$${i.totalEarned}`,
    ),
  );
  console.log(`Who→Whom links: ${links.items.filter((l) => seedIds.has(l.referredUserId)).length}`);

  const approvedCount = await ReferralReward.countDocuments({
    status: "APPROVED",
    referrer_user: { $in: [...seedIds] },
  });

  const ok =
    tree.stats.directReferrals === 2 &&
    tree.stats.networkSize === 9 &&
    approvedCount >= 9;

  if (!ok) {
    console.error("VALIDATION FAILED", {
      direct: tree.stats.directReferrals,
      network: tree.stats.networkSize,
      approvedCount,
    });
    process.exitCode = 1;
  } else {
    console.log("\nVALIDATION OK");
    console.log("Admin UI: http://localhost:3001/admin/referral/network");
    console.log("Search: sharma  OR  gmail.com  OR  rahul");
    console.log("Rewards: http://localhost:3001/admin/referral");
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
