import { randomBytes } from "crypto";

import MetaQuotesDemoAccount from "../models/MetaQuotesDemoAccount.model.js";
import Account from "../models/Account.model.js";
import AccountAuth from "../models/AccountAuth.model.js";
import AccountPlan from "../models/AccountPlan.model.js";
import User from "../models/User.model.js";
import EngineSync from "../trade-engine/EngineSync.js";
import { publishAccountSnapshot } from "../trade-engine/EngineSyncBus.js";
import { comparePassword, hashPassword } from "../utils/hash.util.js";
import { accountLoginService } from "./accountAuth.service.js";

/**
 * MetaQuotes demo accounts (mobile app).
 * Registration data `metaquotes_demo_accounts` me; trading ke liye har
 * account ka ek asli demo `Account` + `AccountAuth` banta hai (account
 * number = MQ login id, trade password = MQ password, watch password =
 * investor password), aur login pe usi ka trading session milta hai.
 */

function generatePassword() {
  // MT5-style 8-char password, e.g. "T*T4SxQv" / "A_EzF0Hn":
  // always has upper + lower + digit + one symbol, shuffled.
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "*_";
  const all = upper + lower + digits + symbols;
  const pick = (s) => s[randomBytes(1)[0] % s.length];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 8) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function generateLoginId() {
  for (let i = 0; i < 20; i++) {
    const candidate = String(
      Math.floor(10000000 + Math.random() * 89999999),
    );
    // MQ login id hi trading account number banta hai - dono me unique.
    const [mq, acc] = await Promise.all([
      MetaQuotesDemoAccount.exists({ login_id: candidate }),
      Account.exists({ account_number: candidate }),
    ]);
    if (!mq && !acc) return candidate;
  }
  throw new Error("Could not generate account login, please try again");
}

function parseLeverage(value) {
  const m = /(\d+)\s*$/.exec(String(value || ""));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * MQ demo ka trading Account (+ AccountAuth) - na ho to banao.
 * `doc` me password_hash / investor_password_hash selected hone chahiye.
 */
async function ensureTradingAccount(doc) {
  let account = doc.trading_account_id
    ? await Account.findById(doc.trading_account_id).lean()
    : null;
  if (!account) {
    account = await Account.findOne({ account_number: doc.login_id }).lean();
  }

  if (!account) {
    const plan = await AccountPlan.findOne({
      isActive: true,
      is_demo_allowed: true,
    }).lean();
    if (!plan) throw new Error("No demo plan available");

    // Har MQ demo ka apna user (synthetic e-mail) - asli FP user ki
    // e-mail se takrav / portal me ghuspaith na ho.
    const email = `mq-${doc.login_id}@metaquotes.demo`;
    const name = [doc.first_name, doc.second_name]
      .map((s) => String(s || "").trim())
      .filter(Boolean)
      .join(" ");
    const user =
      (await User.findOne({ email }).lean()) ||
      (await User.create({ email, name, isMailVerified: true }));

    const balance = Number(doc.balance ?? doc.deposit) || 0;
    const created = await Account.create({
      user_id: user._id,
      account_plan_id: plan._id,
      account_number: doc.login_id,
      account_type: "demo",
      plan_name: plan.name,
      leverage:
        parseLeverage(doc.leverage) ||
        (typeof plan.max_leverage === "number" ? plan.max_leverage : 100),
      spread_enabled:
        typeof plan.spread_enabled === "boolean" ? plan.spread_enabled : true,
      spread_pips: typeof plan.spreadPips === "number" ? plan.spreadPips : 0,
      commission_per_lot:
        typeof plan.commission_per_lot === "number"
          ? plan.commission_per_lot
          : 0,
      swap_enabled:
        typeof plan.swap_enabled === "boolean" ? plan.swap_enabled : true,
      swap_charge:
        typeof plan.swap_charge === "number" ? Math.abs(plan.swap_charge) : 0,
      balance,
      equity: balance,
      currency: doc.currency || plan.currency || "USD",
      status: "active",
    });
    account = created.toObject();
    await EngineSync.onAccountCreated(created._id);
    publishAccountSnapshot(created);
  }

  const auth = await AccountAuth.exists({ account_id: account._id });
  if (!auth) {
    await AccountAuth.create({
      account_id: account._id,
      account_number: account.account_number,
      trade_password_hash: doc.password_hash,
      // Watch (investor) password trade se alag hona zaroori hai.
      watch_password_hash:
        doc.investor_password_hash || (await hashPassword(generatePassword())),
      login_attempts: 0,
      is_locked: false,
      credentials_created_at: new Date(),
    });
  }

  if (String(doc.trading_account_id || "") !== String(account._id)) {
    await MetaQuotesDemoAccount.updateOne(
      { _id: doc._id },
      { $set: { trading_account_id: account._id } },
    );
  }
  return account;
}

function publicView(doc, extra = {}) {
  return {
    login_id: doc.login_id,
    client_id: doc.email,
    email: doc.email,
    first_name: doc.first_name,
    second_name: doc.second_name,
    server: doc.server,
    account_type: doc.account_type,
    leverage: doc.leverage,
    hedge: doc.hedge,
    deposit: doc.deposit,
    balance: doc.balance,
    currency: doc.currency,
    ...extra,
  };
}

/** MQ demo ke trading account ka session (same as FP account-auth login). */
async function tradingSession(doc, password, meta) {
  const account = await ensureTradingAccount(doc);
  const session = await accountLoginService({
    account_number: account.account_number,
    password,
    ip: meta?.ip,
    device: meta?.device,
  });
  return { account, session };
}

export async function registerMetaQuotesDemoService(body, meta) {
  const firstName = String(body.first_name || "").trim();
  const secondName = String(body.second_name || "").trim();
  const dateOfBirth = String(body.date_of_birth || "").trim();
  const phone = String(body.phone || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const deposit = Number(body.deposit);

  if (!firstName) throw new Error("First name is required");
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Valid E-Mail is required");
  }
  if (!Number.isFinite(deposit) || deposit <= 0) {
    throw new Error("Deposit is required");
  }

  const existing = await MetaQuotesDemoAccount.findOne({ email }).lean();
  if (existing) {
    throw new Error("An account with this E-Mail already exists");
  }

  const password = generatePassword();
  let investorPassword = generatePassword();
  while (investorPassword === password) investorPassword = generatePassword();
  const doc = await MetaQuotesDemoAccount.create({
    login_id: await generateLoginId(),
    email,
    password_hash: await hashPassword(password),
    investor_password_hash: await hashPassword(investorPassword),
    first_name: firstName,
    second_name: secondName,
    date_of_birth: dateOfBirth,
    phone,
    server: String(body.server || "MetaQuotes-Demo"),
    account_type: String(body.account_type || "Forex Hedged USD"),
    leverage: String(body.leverage || "1:100"),
    hedge: body.hedge !== false,
    deposit,
    balance: deposit,
    currency: String(body.currency || "USD"),
  });

  const { account, session } = await tradingSession(
    doc.toObject(),
    password,
    meta,
  );

  // Plain passwords are returned ONCE so the app can show them to the
  // user (success screen); only the hashes are stored.
  return publicView(doc.toObject(), {
    balance: account.balance,
    password,
    investor_password: investorPassword,
    session,
  });
}

export async function loginMetaQuotesDemoService(body, meta) {
  // type: "CLIENT_ID" (identifier = e-mail) | "TRADE_ACCOUNT" (login id)
  const type = String(body.type || "CLIENT_ID").toUpperCase();
  const identifier = String(body.identifier || "").trim();
  const password = String(body.password || "");

  if (!identifier || !password) {
    throw new Error("Login and password are required");
  }

  const query =
    type === "TRADE_ACCOUNT"
      ? { login_id: identifier, status: "active" }
      : { email: identifier.toLowerCase(), status: "active" };

  const doc = await MetaQuotesDemoAccount.findOne(query).select(
    "+password_hash +investor_password_hash",
  );
  if (!doc) throw new Error("Invalid credentials");

  const ok = await comparePassword(password, doc.password_hash);
  if (!ok) throw new Error("Invalid credentials");

  doc.last_login_at = new Date();
  await doc.save();

  // Purane MQ accounts ka trading account yahin (pehli login pe) banta hai.
  const { account, session } = await tradingSession(
    doc.toObject(),
    password,
    meta,
  );

  return publicView(doc.toObject(), { balance: account.balance, session });
}
