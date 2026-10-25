import mongoose from 'mongoose';

const depositSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    account: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
      index: true
    },

    amount: {
      type: Number,
      required: true,
      min: 1
    },

    method: {
      type: String,
      enum: ['UPI', 'BANK', 'CRYPTO', 'MANUAL', 'INTERNATIONAL'],
      required: true
    },

    proof: {
      image_url: {
        type: String,
        default: ""
      },
      image_public_id: {
        type: String,
        default: ""
      }
    },

    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
      index: true
    },

    bonus_percent: {
      type: Number,
      default: 0,
      min: 0
    },

    bonus_amount: {
      type: Number,
      default: 0,
      min: 0
    },

    rejectionReason: {
      type: String,
      default: ''
    },

    actionBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    },

    actionAt: {
      type: Date,
      default: null
    },

    ipAddress: {
      type: String,
      required: true,
      default: '127.0.0.1'
    }
  },
  { timestamps: true }
);

export default mongoose.model('Deposit', depositSchema);
