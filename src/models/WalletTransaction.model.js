import mongoose from "mongoose";

const WalletTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // CREDIT = money into wallet, DEBIT = money out of wallet
    type: {
      type: String,
      enum: ["CREDIT", "DEBIT"],
      required: true,
      index: true,
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    // Wallet balance snapshot after this transaction
    balanceAfter: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED"],
      default: "SUCCESS",
      index: true,
    },

    referenceType: {
      type: String,
      enum: [
        "INTERNAL_TRANSFER",
        "WITHDRAWAL",
        "REFERRAL",
        "ADMIN_ADJUST",
        "SYSTEM",
      ],
      index: true,
    },

    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      index: true,
    },

    // Counterparty account for wallet<->account transfers
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    remark: {
      type: String,
      trim: true,
      default: "",
    },

    ipAddress: {
      type: String,
      default: "",
      trim: true,
    },
  },
  {
    timestamps: true,
  },
);

WalletTransactionSchema.index({ user: 1, createdAt: -1 });
WalletTransactionSchema.index({ referenceType: 1, referenceId: 1 });

export default mongoose.model("WalletTransaction", WalletTransactionSchema);
