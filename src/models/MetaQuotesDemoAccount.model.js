import mongoose from "mongoose";

/**
 * MetaQuotes demo accounts opened from the mobile app (Brokers ->
 * MetaQuotes Ltd. -> Open a demo account).
 *
 * Registration profile (login id + e-mail client id + password hash)
 * yahan rehta hai; trading ke liye har MQ demo ka ek asli demo
 * `Account` (+ AccountAuth) bhi banta hai - `trading_account_id` -
 * taaki trade engine isi account pe orders chalaye.
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

    // Server trading account (Account._id) jispe is MQ demo ke trades chalte hain.
    trading_account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
      index: true,
    },
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
