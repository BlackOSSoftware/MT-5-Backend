import mongoose from "mongoose";

/**
 * MetaQuotes demo accounts opened from the mobile app (Brokers ->
 * MetaQuotes Ltd. -> Open a demo account).
 *
 * These live in their OWN collection on purpose: they are NOT server
 * trading accounts (not in `accounts` / trade engine). The app trades
 * them locally on the device; the server only stores the registration
 * (login id + e-mail client id + password hash) so the user can log
 * in again later.
 */
const MetaQuotesDemoAccountSchema = new mongoose.Schema(
  {
    // Trade account login shown to the user (e.g. 8-digit number)
    login_id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // Client ID = e-mail used at registration
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },

    password_hash: {
      type: String,
      required: true,
      select: false,
    },

    // Read-only "investor" password (shown once at registration,
    // like MT5). Stored hashed; not used for app login yet.
    investor_password_hash: {
      type: String,
      default: null,
      select: false,
    },

    first_name: { type: String, required: true, trim: true },
    second_name: { type: String, default: "", trim: true },
    date_of_birth: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },

    server: { type: String, default: "MetaQuotes-Demo" },
    account_type: { type: String, default: "Forex Hedged USD" },
    leverage: { type: String, default: "1:100" },
    hedge: { type: Boolean, default: true },

    deposit: { type: Number, required: true, min: 0 },
    balance: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },

    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      index: true,
    },

    last_login_at: { type: Date, default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "metaquotes_demo_accounts",
  },
);

export default mongoose.model(
  "MetaQuotesDemoAccount",
  MetaQuotesDemoAccountSchema,
);
