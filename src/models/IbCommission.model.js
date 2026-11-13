import mongoose from "mongoose";

/**
 * Lot-wise IB commission ledger (from user spread allocation).
 * Unique per trade + IB user + level to prevent double credit.
 */
const IbCommissionSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      default: null,
      index: true,
    },

    ib_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    trader_user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },

    trade_id: {
      type: String,
      required: true,
      index: true,
    },

    position_id: {
      type: String,
      default: null,
      index: true,
    },

    plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountPlan",
      default: null,
    },

    symbol: {
      type: String,
      required: true,
      uppercase: true,
      index: true,
    },

    lots: {
      type: Number,
      required: true,
      min: 0,
    },

    level: {
      type: Number,
      required: true,
      min: 1,
    },

    /** Snapshot: plan IB budget $/lot */
    ib_usd_per_lot: {
      type: Number,
      required: true,
      min: 0,
    },

    /** Snapshot: house $/lot */
    house_usd_per_lot: {
      type: Number,
      default: 0,
      min: 0,
    },

    /** Snapshot: client spread width applied */
    client_spread: {
      type: Number,
      default: 0,
      min: 0,
    },

    percent: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },

    amount: {
      type: Number,
      required: true,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "AVAILABLE",
        "PAID",
        "REVERSED",
        "CLAWBACK_PENDING",
        "CANCELLED",
      ],
      default: "AVAILABLE",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

IbCommissionSchema.index(
  { trade_id: 1, ib_user_id: 1, level: 1 },
  { unique: true, name: "uniq_ib_commission_trade_user_level" },
);

export default mongoose.model("IbCommission", IbCommissionSchema);
