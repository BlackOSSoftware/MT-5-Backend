import mongoose from "mongoose";

const AccountAuthSchema = new mongoose.Schema(
  {
    account_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      unique: true,
      index: true,
    },

    account_number: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    trade_password_hash: {
      type: String,
      required: true,
      select: false,
    },

    watch_password_hash: {
      type: String,
      required: true,
      select: false,
    },

    // MT5 app ke extra passwords (login ke liye nahi, sirf record).
    trader_password_hash: {
      type: String,
      default: null,
      select: false,
    },

    money_manager_password_hash: {
      type: String,
      default: null,
      select: false,
    },

    login_attempts: {
      type: Number,
      default: 0,
    },

    last_login_at: Date,
    last_login_ip: String,
    last_login_device: String,

    // ✅ ADD THIS
    fcm_token: {
      type: String,
      default: null,
      index: true,
    },

    access_token_hash: {
      type: String,
      select: false,
    },

    access_token_expires_at: Date,

    refresh_token_hash: {
      type: String,
      select: false,
    },

    refresh_token_expires_at: Date,

    is_locked: {
      type: Boolean,
      default: false,
      index: true,
    },

    credentials_created_at: {
      type: Date,
      required: true,
    },

    credentials_last_reset_at: Date,
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export default mongoose.model("AccountAuth", AccountAuthSchema);
