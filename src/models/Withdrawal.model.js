import mongoose from "mongoose";

const WithdrawalSchema = new mongoose.Schema(
  {
    // USER
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ACCOUNT
    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },

    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      default: null,
      index: true,
    },

    // AMOUNT
    amount: {
      type: Number,
      required: true,
      min: 1,
    },

    // BONUS SNAPSHOT
    bonus_percent: {
      type: Number,
      default: 0,
      min: 0,
    },

    bonus_deducted: {
      type: Number,
      default: 0,
      min: 0,
    },

    // METHOD
    method: {
      type: String,
      enum: ["UPI", "BANK", "CRYPTO", "MANUAL"],
      required: true,
      index: true,
    },

    // PAYOUT DETAILS
    payout: {
      // UPI
      upi_id: {
        type: String,
        default: "",
        trim: true,
      },

      // BANK
      bank_name: {
        type: String,
        default: "",
        trim: true,
      },
      account_holder_name: {
        type: String,
        default: "",
        trim: true,
      },
      account_number: {
        type: String,
        default: "",
        trim: true,
      },
      ifsc: {
        type: String,
        default: "",
        trim: true,
      },

      // CRYPTO
      crypto_network: {
        type: String,
        default: "",
        trim: true,
      },
      crypto_address: {
        type: String,
        default: "",
        trim: true,
      },

      // MANUAL
      note: {
        type: String,
        default: "",
        trim: true,
      },
    },

    // STATUS
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED", "PROCESSING", "COMPLETED", "FAILED"],
      default: "PENDING",
      index: true,
    },

    // ADMIN ACTION
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
    },

    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
      index: true,
    },

    actionAt: {
      type: Date,
      default: null,
    },

    // SECURITY
    ipAddress: {
      type: String,
      required: true,
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

// PERFORMANCE INDEXES
WithdrawalSchema.index({ user: 1, createdAt: -1 });
WithdrawalSchema.index({ account: 1, createdAt: -1 });
WithdrawalSchema.index({ status: 1, createdAt: -1 });
WithdrawalSchema.index({ method: 1, createdAt: -1 });
WithdrawalSchema.index({ user: 1, status: 1, createdAt: -1 });

export default mongoose.model("Withdrawal", WithdrawalSchema);
