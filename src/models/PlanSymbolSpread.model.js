import mongoose from "mongoose";

/**
 * Per AccountPlan × Symbol spread / IB budget.
 * Admin sets Company $ + IB $ per lot; client_spread width is derived from contractSize.
 */
const PlanSymbolSpreadSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      default: null,
      index: true,
    },

    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountPlan",
      required: true,
      index: true,
    },

    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      index: true,
    },

    /** Company / broker share in USD per 1.00 lot */
    house_usd_per_lot: {
      type: Number,
      default: 0,
      min: 0,
    },

    /** Total IB budget in USD per 1.00 lot (split by level %) */
    ib_usd_per_lot: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * Optional override of computed width.
     * If null, resolver uses (house+ib) / contractSize.
     */
    client_spread_override: {
      type: Number,
      default: null,
      min: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

PlanSymbolSpreadSchema.index(
  { planId: 1, symbol: 1 },
  { unique: true, name: "uniq_plan_symbol_spread" },
);

export default mongoose.model("PlanSymbolSpread", PlanSymbolSpreadSchema);
