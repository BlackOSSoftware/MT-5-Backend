import mongoose from "mongoose";

const conversionRateSchema = new mongoose.Schema(
  {
    // GLOBAL (legacy) or BROKER:<ObjectId>
    key: {
      type: String,
      required: true,
      unique: true,
    },
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      default: null,
      index: true,
    },
    usdtInr: {
      type: Number,
      required: true,
      min: 0.00000001,
      default: 90,
    },
    btcUsdt: {
      type: Number,
      required: true,
      min: 0.00000001,
      default: 100000,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

conversionRateSchema.index(
  { brokerId: 1 },
  {
    unique: true,
    partialFilterExpression: { brokerId: { $type: "objectId" } },
  },
);

export default mongoose.model("ConversionRate", conversionRateSchema);
