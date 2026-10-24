import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    action: {
      type: String,
      required: true,
      enum: [
        'USER_CREATED',
        'PASSWORD_CHANGED',
        'PASSWORD_RESET',
        'PASSWORD_CHANGED_BY_ADMIN',
        'TRADE_CLOSED_EDITED_BY_ADMIN',
        'TRADE_DELETED_BY_ADMIN',
        'TRADE_RESTORED_BY_ADMIN'
      ],
      index: true
    },

    actor_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true
    },

    actor_type: {
      type: String,
      enum: ['SELF', 'ADMIN', 'SYSTEM'],
      default: 'SYSTEM',
      index: true
    }
  },
  {
    timestamps: true
  }
);

activityLogSchema.index({ user_id: 1, createdAt: -1, _id: -1 });
activityLogSchema.index({ createdAt: -1, _id: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);
