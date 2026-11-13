import mongoose from "mongoose";

/**
 * Broker-scoped IB level split of the plan IB $/lot budget.
 * percents must sum to <= 100.
 */
const IbLevelSettingsSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      default: null,
      index: true,
      unique: true,
      sparse: true,
    },

    levels: {
      type: [
        {
          level: { type: Number, required: true, min: 1 },
          percent: { type: Number, required: true, min: 0, max: 100 },
        },
      ],
      default: [
        { level: 1, percent: 70 },
        { level: 2, percent: 30 },
      ],
    },

    maxDepth: {
      type: Number,
      default: 2,
      min: 1,
      max: 10,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

export default mongoose.model("IbLevelSettings", IbLevelSettingsSchema);
