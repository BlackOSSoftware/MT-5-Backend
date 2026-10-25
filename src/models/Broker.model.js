import mongoose from "mongoose";
import { BROKER_STATUS } from "../constants/brokerPermissions.js";

const BrokerSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    legalName: { type: String, trim: true, default: "" },
    displayName: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(BROKER_STATUS),
      default: BROKER_STATUS.ACTIVE,
      index: true,
    },
    baseCurrency: { type: String, default: "USD", uppercase: true },
    timezone: { type: String, default: "Asia/Kolkata" },
    country: { type: String, default: "" },
    branding: {
      primaryColor: { type: String, default: "#0066FF" },
      logoUrl: { type: String, default: "" },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Broker", BrokerSchema);
