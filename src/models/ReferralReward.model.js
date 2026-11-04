import mongoose from "mongoose";

const ReferralRewardSchema = new mongoose.Schema(
  {
    // Referred user (one-time reward per referred user)
    referred_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
      unique: true,
    },

    // Referrer who will receive the reward
    referrer_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Account that triggered eligibility (first approved deposit)
    referred_account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },

    // Plan snapshot used for reward amount
    plan_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AccountPlan",
      required: true,
    },

    // Optional: first deposit trigger. Live-account open can also create eligibility.
    deposit_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Deposit",
      default: null,
      index: true,
    },

    reward_amount: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["ELIGIBLE", "REQUESTED", "APPROVED", "REJECTED"],
      default: "ELIGIBLE",
      index: true,
    },

    // Referrer-selected account to receive the reward
    requested_account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
    },

    requested_at: {
      type: Date,
      default: null,
    },

    approved_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    approved_at: {
      type: Date,
      default: null,
    },

    rejected_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    rejected_at: {
      type: Date,
      default: null,
    },

    rejection_reason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

ReferralRewardSchema.index({ referrer_user: 1, status: 1, createdAt: -1 });
ReferralRewardSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model("ReferralReward", ReferralRewardSchema);
