import mongoose from "mongoose";

const BrokerRiskSettingSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      required: true,
      unique: true,
      index: true,
    },
    /** Push risk warning when floating loss % reaches this (0–100). */
    warning_loss_percent: {
      type: Number,
      default: 70,
      min: 0,
      max: 100,
    },
    /** Force-close (STOP_OUT) when floating loss % reaches this (1–100). */
    stop_out_loss_percent: {
      type: Number,
      default: 90,
      min: 1,
      max: 100,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

export default mongoose.model("BrokerRiskSetting", BrokerRiskSettingSchema);
