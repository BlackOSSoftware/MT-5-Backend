import mongoose from "mongoose";

const AccountSchema = new mongoose.Schema(
  {
    // USER
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Multi-broker tenant
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      default: null,
      index: true,
    },

    // PLAN REFERENCE
    account_plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountPlan",
      required: true,
      index: true,
    },

    // ACCOUNT IDENTIFICATION
    account_number: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    account_type: {
      type: String,
      enum: ["demo", "live"],
      required: true,
      index: true,
    },

    // PLAN SNAPSHOT
    plan_name: {
      type: String,
      required: true,
      index: true,
    },

    leverage: {
      type: Number,
      required: true,
    },

    // ✅ SPREAD CONTROL (NEW)
    spread_enabled: {
      type: Boolean,
      default: true, // ✅ spread ON by default
      index: true,
    },

    // ACCOUNT CUSTOM SPREAD (0 = use symbol spread)
    spread_pips: {
      type: Number,
      default: 0,
      min: 0,
    },

    commission_per_lot: {
      type: Number,
      default: 0,
    },

    swap_enabled: {
      type: Boolean,
      default: true,
    },

    // SWAP CHARGE
    swap_charge: {
      type: Number,
      default: 0,
      min: 0,
    },

    // SWAP ROLLOVER (CRON) - idempotency markers
    // Used to ensure overnight swap is charged once per day per account.
    swap_last_charged_ymd: {
      type: String, // YYYY-MM-DD (cron timezone)
      default: null,
      index: true,
    },

    swap_last_charged_at: {
      type: Date,
      default: null,
    },

    // FINANCIALS
    balance: {
      type: Number,
      default: 0,
      min: 0,
    },

    hold_balance: {
      type: Number,
      default: 0,
      min: 0,
    },

    non_withdrawable_balance: {
      type: Number,
      default: 0,
      min: 0,
    },

    equity: {
      type: Number,
      default: 0,
      min: 0,
    },

    // BONUS / CREDIT
    bonus_balance: {
      type: Number,
      default: 0,
      min: 0,
    },

    bonus_granted: {
      type: Number,
      default: 0,
      min: 0,
    },

    // Per-account override percent (null = use global default)
    bonus_percent_override: {
      type: Number,
      default: null,
      min: 0,
    },

    currency: {
      type: String,
      required: true,
    },

    // FIRST DEPOSIT
    first_deposit: {
      type: Boolean,
      default: false,
      index: true,
    },

    // STATUS
    status: {
      type: String,
      enum: ["active", "disabled"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// INDEXES
AccountSchema.index({ user_id: 1, account_type: 1 });
AccountSchema.index({ user_id: 1, status: 1 });

export default mongoose.model("Account", AccountSchema);
