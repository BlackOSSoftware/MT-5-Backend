import { randomBytes } from "crypto";

import MetaQuotesDemoAccount from "../models/MetaQuotesDemoAccount.model.js";
import { comparePassword, hashPassword } from "../utils/hash.util.js";

/**
 * MetaQuotes demo accounts (mobile app).
 * Registration data is stored in Mongo (`metaquotes_demo_accounts`),
 * but trading for these accounts happens locally in the app - nothing
 * is sent to the server trade engine.
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
    const exists = await MetaQuotesDemoAccount.exists({
      login_id: candidate,
    });
    if (!exists) return candidate;
  }
  throw new Error("Could not generate account login, please try again");
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

export async function registerMetaQuotesDemoService(body) {
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
  const investorPassword = generatePassword();
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

  // Plain passwords are returned ONCE so the app can show them to the
  // user (success screen); only the hashes are stored.
  return publicView(doc.toObject(), {
    password,
    investor_password: investorPassword,
  });
}

export async function loginMetaQuotesDemoService(body) {
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
    "+password_hash",
  );
  if (!doc) throw new Error("Invalid credentials");

  const ok = await comparePassword(password, doc.password_hash);
  if (!ok) throw new Error("Invalid credentials");

  doc.last_login_at = new Date();
  await doc.save();

  return publicView(doc.toObject());
}
