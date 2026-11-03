import mongoose from 'mongoose';

const adminNotificationReadSchema = new mongoose.Schema(
  {
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    notification_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PublicNotification',
      required: true,
      index: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

adminNotificationReadSchema.index(
  { admin_id: 1, notification_id: 1 },
  { unique: true }
);

export default mongoose.model(
  'AdminNotificationRead',
  adminNotificationReadSchema
);
