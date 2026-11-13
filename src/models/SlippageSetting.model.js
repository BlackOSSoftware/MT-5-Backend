import mongoose from "mongoose";

/**
 * Global admin-controlled slippage configuration (singleton, key = "GLOBAL").
 * Mirrors the BonusSetting pattern: one document, upserted by admins,
 * fanned out to every engine worker via EngineSyncBus.
 */
const SlippageSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    /** Master switch — default DISABLED so existing execution is unchanged. */
    enabled: {
      type: Boolean,
      default: false,
    },

    /** FIXED = fixed_points for every order; RANDOM = uniform in [min,max]. */
    mode: {
      type: String,
      enum: ["FIXED", "RANDOM"],
      default: "FIXED",
    },

    /** Points applied per order when mode = FIXED. */
    fixed_points: {
      type: Number,
      default: 0,
      min: 0,
    },

    /** Lower bound (points) when mode = RANDOM. */
    min_points: {
      type: Number,
      default: 0,
      min: 0,
    },

    /** Upper bound (points) when mode = RANDOM. Must be >= min_points. */
    max_points: {
      type: Number,
      default: 0,
      min: 0,
    },

    /** Apply slippage to MARKET orders opened via /trade/market. */
    apply_market_orders: {
      type: Boolean,
      default: true,
    },

    /** Apply slippage to STOP orders (BUY_STOP / SELL_STOP) at trigger time. */
    apply_stop_orders: {
      type: Boolean,
      default: true,
    },

    /** Reserved for future close-side slippage — kept OFF for now. */
    apply_close: {
      type: Boolean,
      default: false,
    },

    /** Only ADVERSE_ONLY is supported (price moves against the client). */
    direction: {
      type: String,
      enum: ["ADVERSE_ONLY"],
      default: "ADVERSE_ONLY",
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export default mongoose.model("SlippageSetting", SlippageSettingSchema);
