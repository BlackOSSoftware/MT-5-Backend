/**
 * Broker-configurable user withdrawal methods.
 * MANUAL / CRYPTO kept for legacy admin & historical rows.
 */
export const WITHDRAW_METHOD_CODES = [
  "UPI",
  "BANK",
  "INDIAN_BANK",
  "NETELLER",
  "SKRILL",
  "USDT",
  "BITCOIN",
];

export const WITHDRAW_METHOD_DEFS = [
  {
    code: "BANK",
    label: "Bank Transfer",
    description: "International bank payout (SWIFT)",
    fields: [
      { key: "account_holder_name", label: "Account holder name", required: true },
      { key: "bank_name", label: "Bank name", required: true },
      { key: "account_number", label: "Account number", required: true },
      { key: "swift_code", label: "Swift code", required: false },
    ],
  },
  {
    code: "INDIAN_BANK",
    label: "Indian Bank Transfer",
    description: "INR bank payout with IFSC",
    fields: [
      { key: "account_holder_name", label: "Account holder name", required: true },
      { key: "bank_name", label: "Bank name", required: true },
      { key: "account_number", label: "Account number", required: true },
      { key: "ifsc", label: "IFSC code", required: true },
    ],
  },
  {
    code: "UPI",
    label: "UPI Transfer",
    description: "Pay via UPI ID",
    fields: [{ key: "upi_id", label: "UPI ID", required: true }],
  },
  {
    code: "NETELLER",
    label: "Neteller",
    description: "Neteller email payout",
    fields: [{ key: "email", label: "Email", required: true }],
  },
  {
    code: "SKRILL",
    label: "Skrill",
    description: "Skrill email payout",
    fields: [{ key: "email", label: "Email", required: true }],
  },
  {
    code: "USDT",
    label: "USDT",
    description: "USDT wallet payout",
    fields: [
      { key: "crypto_address", label: "Address", required: true },
      { key: "crypto_network", label: "Network", required: true },
    ],
  },
  {
    code: "BITCOIN",
    label: "Bitcoin",
    description: "BTC wallet payout",
    fields: [{ key: "crypto_address", label: "Address", required: true }],
  },
];

/** Defaults when a broker has no settings doc yet (backward-compatible). */
export const DEFAULT_ENABLED_WITHDRAW_METHODS = {
  UPI: true,
  BANK: true,
  INDIAN_BANK: true,
  NETELLER: false,
  SKRILL: false,
  USDT: true,
  BITCOIN: false,
};

export function normalizeEnabledMap(raw = {}) {
  const out = { ...DEFAULT_ENABLED_WITHDRAW_METHODS };
  for (const code of WITHDRAW_METHOD_CODES) {
    if (typeof raw[code] === "boolean") out[code] = raw[code];
  }
  return out;
}

export function isConfigurableWithdrawMethod(method) {
  return WITHDRAW_METHOD_CODES.includes(String(method || "").toUpperCase());
}
