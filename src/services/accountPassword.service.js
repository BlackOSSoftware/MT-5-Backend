import AccountAuth from "../models/AccountAuth.model.js";
import MetaQuotesDemoAccount from "../models/MetaQuotesDemoAccount.model.js";
import { comparePassword, hashPassword } from "../utils/hash.util.js";

/**
 * MT5 app "Change password" (logged-in account ka apna token):
 *  master        -> trade password (login)
 *  investor      -> watch (read-only) password
 *  trader        -> record only
 *  money_manager -> record only
 * Har change ke liye current MASTER password zaroori hai.
 */
const FIELD = {
  master: "trade_password_hash",
  investor: "watch_password_hash",
  trader: "trader_password_hash",
  money_manager: "money_manager_password_hash",
};

function assertStrong(password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    /\s/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error(
      "Password must be strong and contain at least 8 characters, including lower- and uppercase letters, numbers and special symbols",
    );
  }
}

export async function changeAccountPasswordService({
  accountId,
  kind,
  currentPassword,
  newPassword,
}) {
  const field = FIELD[String(kind || "").toLowerCase()];
  if (!field) throw new Error("Invalid password type");
  if (!currentPassword) throw new Error("Current master password is required");
  assertStrong(newPassword);

  // Match by ObjectId or string account_id (legacy rows).
  const auth = await AccountAuth.findOne({
    $or: [{ account_id: accountId }, { account_id: String(accountId) }],
    is_locked: false,
  }).select("+trade_password_hash +watch_password_hash");
  if (!auth) throw new Error("Account auth not found or locked");

  const masterOk = await comparePassword(
    String(currentPassword),
    auth.trade_password_hash,
  );
  if (!masterOk) throw new Error("Invalid current master password");

  // Login rule: trade aur watch password kabhi same nahi.
  if (field === "trade_password_hash" && auth.watch_password_hash) {
    if (await comparePassword(newPassword, auth.watch_password_hash)) {
      throw new Error("Master password must differ from investor password");
    }
  }
  if (field === "watch_password_hash") {
    if (await comparePassword(newPassword, auth.trade_password_hash)) {
      throw new Error("Investor password must differ from master password");
    }
  }

  const hash = await hashPassword(newPassword);
  await AccountAuth.updateOne({ _id: auth._id }, { $set: { [field]: hash } });

  // MQ demo ka profile bhi wahi password use karta hai (app login).
  if (field === "trade_password_hash" || field === "watch_password_hash") {
    await MetaQuotesDemoAccount.updateOne(
      { trading_account_id: auth.account_id },
      {
        $set: {
          [field === "trade_password_hash"
            ? "password_hash"
            : "investor_password_hash"]: hash,
        },
      },
    );
  }

  return { success: true, kind: String(kind).toLowerCase() };
}
