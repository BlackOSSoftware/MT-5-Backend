import mongoose from 'mongoose';

const publicNotificationSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true
    },

    message: {
      type: String,
      required: true
    },

    data: {
      type: Object,
      default: {}
    },

    // null = broadcast to all; set = targeted push to one portal user
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    // null = platform-wide (SuperAdmin); set = only this broker's recipients
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Broker',
      default: null,
      index: true,
    },

    // Who a broadcast is for: client users or broker admins
    audience: {
      type: String,
      enum: ['USERS', 'ADMINS'],
      default: 'USERS',
      index: true,
    },

    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true
    },

    expireAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }
    }
  },
  { timestamps: true }
);

export default mongoose.model(
  'PublicNotification',
  publicNotificationSchema
);
