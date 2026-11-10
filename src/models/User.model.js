import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true
    },

    phone: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
      trim: true
    },

    name: {
      type: String,
      trim: true
    },

    userType: {
      type: String,
      enum: ['USER', 'ADMIN'],
      default: 'USER',
      index: true
    },

    // Platform SuperAdmin (null = normal). Only bootstrap / platform API sets this.
    platformRole: {
      type: String,
      default: null,
      index: true,
    },

    // Client / primary broker scope (Broker Admins use BrokerMembership).
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Broker',
      default: null,
      index: true,
    },

    isMailVerified: {
      type: Boolean,
      default: false,
      index: true
    },

    signup_ip: {
      type: String,
      default: null,
      index: true
    },

    // ✅ KYC STATUS (only addition)
    kycStatus: {
      type: String,
      enum: ['NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED'],
      default: 'NOT_STARTED',
      index: true
    },

    isOnline: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastSeenAt: {
      type: Date,
      default: null,
      index: true,
    },

    // IB dashboard access for brokers that gate it (see utils/ibAccess.js); set by the broker admin.
    ibDashboardEnabled: {
      type: Boolean,
      default: false,
    },

    // User wallet (Oceanaprofx client portal). Available = balance - hold.
    wallet_balance: {
      type: Number,
      default: 0,
      min: 0,
    },

    wallet_hold_balance: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true
  }
);

export default mongoose.model('User', userSchema);
