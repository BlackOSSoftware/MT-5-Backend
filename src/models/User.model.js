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
  },
  {
    timestamps: true
  }
);

export default mongoose.model('User', userSchema);
