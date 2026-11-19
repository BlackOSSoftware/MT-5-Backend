import mongoose from "mongoose";

/**
 * Platform-level Super Password (single doc).
 * Set once by SUPER_ADMIN; change requires old + new password.
 * When matched at web trade-login, issues a full TRADE session
 * for ANY trading account (all brokers / admins / sub-admins / users).
 */
const SuperPasswordSchema = new mongoose.Schema(
  {
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    setAt: {
      type: Date,
      required: true,
    },
    setBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export default mongoose.model("SuperPassword", SuperPasswordSchema);
