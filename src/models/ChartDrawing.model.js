import mongoose from "mongoose";

/**
 * Chart drawings scoped per user + trading account + symbol + timeframe.
 * One document holds the full drawing set for that scope (bulk sync friendly).
 */
const ChartDrawingSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },
    symbol: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 32,
    },
    timeframe: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 8,
      default: "M5",
    },
    drawings: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    revision: {
      type: Number,
      default: 1,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ChartDrawingSchema.index(
  { userId: 1, accountId: 1, symbol: 1, timeframe: 1 },
  { unique: true, name: "uniq_user_account_symbol_tf" },
);

export default mongoose.model("ChartDrawing", ChartDrawingSchema);
