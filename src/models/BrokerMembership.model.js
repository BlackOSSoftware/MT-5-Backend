import mongoose from "mongoose";
import {
  BROKER_PERMISSIONS,
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUS,
} from "../constants/brokerPermissions.js";

const BrokerMembershipSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: Object.values(MEMBERSHIP_ROLES),
      default: MEMBERSHIP_ROLES.BROKER_ADMIN,
      index: true,
    },
    permissions: {
      type: [String],
      default: [],
      validate: {
        validator(arr) {
          return arr.every((p) => BROKER_PERMISSIONS.includes(p));
        },
        message: "Invalid broker permission",
      },
    },
    status: {
      type: String,
      enum: Object.values(MEMBERSHIP_STATUS),
      default: MEMBERSHIP_STATUS.ACTIVE,
      index: true,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    acceptedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

BrokerMembershipSchema.index({ brokerId: 1, userId: 1 }, { unique: true });

export default mongoose.model("BrokerMembership", BrokerMembershipSchema);
