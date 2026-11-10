/**
 * Seed Standard live trading account + minimum approved deposit
 * for every demo referral user under a referral code.
 *
 * Usage: node scripts/seed-referral-accounts.js [REFERRAL_CODE]
 */
import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../src/config/database.js";
import User from "../src/models/User.model.js";
import Account from "../src/models/Account.model.js";
import AccountPlan from "../src/models/AccountPlan.model.js";
import AccountAuth from "../src/models/AccountAuth.model.js";
import Deposit from "../src/models/Deposit.model.js";
import Transaction from "../src/models/Transaction.model.js";
import Referral from "../src/models/Referral.model.js";
import { hashPassword } from "../src/utils/hash.util.js";
import { generateAccountNumber, generateStrongPassword } from "../src/utils/accountNumber.util.js";
import { createReferralRewardEligibility } from "../src/services/referral.service.js";

const REFERRAL_CODE = (process.argv[2] || "8UPT5U1O").trim().toUpperCase();
const TRADE_PASSWORD = "Trade@12345";

async function getNetworkUserIds(rootId) {
  const ids = new Set();
  let frontier = [rootId];
  while (frontier.length) {
    const rows = await Referral.find({ referred_by: { $in: frontier } })
      .select("user_id")
      .lean();
    frontier = [];
    for (const r of rows) {
      const id = String(r.user_id);
      if (!ids.has(id)) {
        ids.add(id);
        frontier.push(r.user_id);
      }
    }
  }
  return [...ids];
}

async function findStandardPlan(brokerId) {
  const plans = await AccountPlan.find({
    isActive: true,
    is_demo_allowed: { $ne: true },
    ...(brokerId ? { brokerId } : {}),
  }).lean();

  const standard = plans.find((p) => /standard/i.test(p.name || ""));
  if (standard) return standard;
  return plans[0] || null;
}

async function ensureAccount(user, plan, passwordHash) {
  const existing = await Account.findOne({
    user_id: user._id,
    account_plan_id: plan._id,
    account_type: "live",
    status: "active",
  }).lean();
  if (existing) return { account: existing, created: false };

  const accountNumber = generateAccountNumber();
  const watchPass = `${TRADE_PASSWORD}99`;
  const watchHash = await hashPassword(watchPass);

  const hasPrimary = await Account.exists({
    user_id: user._id,
    status: "active",
    is_primary: true,
  });

  const account = await Account.create({
    user_id: user._id,
    account_plan_id: plan._id,
    ...(user.brokerId ? { brokerId: user.brokerId } : {}),
    account_number: accountNumber,
    account_type: "live",
    plan_name: plan.name,
    leverage: plan.max_leverage > 0 ? plan.max_leverage : 500,
    spread_enabled: plan.spread_enabled !== false,
    spread_pips: plan.spreadPips || 0,
    commission_per_lot: plan.commission_per_lot || 0,
    swap_enabled: plan.swap_enabled !== false,
    swap_charge: Math.abs(plan.swap_charge || 0),
    balance: 0,
    equity: 0,
    currency: plan.currency || "USD",
    status: "active",
    is_primary: !hasPrimary,
  });

  await AccountAuth.create({
    account_id: account._id,
    account_number: account.account_number,
    trade_password_hash: passwordHash,
    watch_password_hash: watchHash,
    login_attempts: 0,
    is_locked: false,
    credentials_created_at: new Date(),
  });

  return { account, created: true };
}

async function ensureDeposit(user, account, plan) {
  const existing = await Deposit.findOne({
    user: user._id,
    account: account._id,
    status: "APPROVED",
  }).lean();
  if (existing) return { deposit: existing, created: false };

  const amount = Math.max(Number(plan.minDeposit || 0), 50);

  const deposit = await Deposit.create({
    user: user._id,
    account: account._id,
    ...(user.brokerId ? { brokerId: user.brokerId } : {}),
    amount,
    method: "MANUAL",
    proof: { image_url: "", image_public_id: "" },
    status: "APPROVED",
    bonus_percent: 0,
    bonus_amount: 0,
    rejectionReason: "",
    actionAt: new Date(),
    ipAddress: "127.0.0.1",
  });

  const newBalance = Number(account.balance || 0) + amount;
  const bonus = Number(account.bonus_balance || 0);
  const newEquity = newBalance + bonus;

  await Account.updateOne(
    { _id: account._id },
    { $set: { balance: newBalance, equity: newEquity, first_deposit: true } },
  );

  await Transaction.create({
    user: user._id,
    account: account._id,
    type: "DEPOSIT",
    amount,
    balanceAfter: newBalance,
    equityAfter: newEquity,
    status: "SUCCESS",
    referenceType: "DEPOSIT",
    referenceId: deposit._id,
    remark: "Deposit approved (demo seed)",
  });

  await createReferralRewardEligibility({
    referredUserId: user._id,
    referredAccountId: account._id,
    planId: plan._id,
    depositId: deposit._id,
  });

  return { deposit, created: true };
}

async function main() {
  await connectDB();

  const rootReferral = await Referral.findOne({ referral_code: REFERRAL_CODE }).lean();
  if (!rootReferral) {
    console.error(`Referral code ${REFERRAL_CODE} not found`);
    process.exit(1);
  }

  const networkIds = await getNetworkUserIds(rootReferral.user_id);
  // Only demo-seeded users (skip the root IB himself)
  const users = await User.find({
    _id: { $in: networkIds, $ne: rootReferral.user_id },
    email: /@demo\.oceanaprofx\.com$/,
  }).lean();

  console.log(`Found ${users.length} demo referral users`);

  const passwordHash = await hashPassword(TRADE_PASSWORD);
  let accountsCreated = 0;
  let depositsCreated = 0;

  for (const user of users) {
    const plan = await findStandardPlan(user.brokerId || null);
    if (!plan) {
      console.log(`  ${user.email}: NO live plan found, skipped`);
      continue;
    }

    const { account, created } = await ensureAccount(user, plan, passwordHash);
    if (created) accountsCreated += 1;

    const { deposit, created: depCreated } = await ensureDeposit(user, account, plan);
    if (depCreated) depositsCreated += 1;

    console.log(
      `  ${user.name}: TA#${account.account_number} (${plan.name}) deposit $${deposit.amount} ${depCreated ? "created" : "exists"}`,
    );
  }

  console.log(`\nDone. Accounts created: ${accountsCreated}, Deposits created: ${depositsCreated}`);
  console.log(`Trade password for all accounts: ${TRADE_PASSWORD}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
