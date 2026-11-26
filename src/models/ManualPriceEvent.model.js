import mongoose from "mongoose";

const manualPriceEventSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      required: true,
      index: true,
    },
    symbol: { type: String, required: true, index: true },
    prevBid: { type: Number, default: null },
    prevAsk: { type: Number, default: null },
    bid: { type: Number, required: true },
    ask: { type: Number, required: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adminEmail: { type: String, default: null },
    positionsChecked: { type: Number, default: 0 },
    positionsClosed: { type: Number, default: 0 },
    affectedAccounts: { type: Number, default: 0 },
    trigger: { type: String, enum: ["SL", "TP", "BOTH"], default: "BOTH" },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

manualPriceEventSchema.index({ brokerId: 1, symbol: 1, createdAt: -1 });

export default mongoose.model("ManualPriceEvent", manualPriceEventSchema);
