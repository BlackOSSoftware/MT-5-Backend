import mongoose from 'mongoose';

const ACTIVITY_CATEGORIES = [
  'AUTH',
  'USER',
  'ACCOUNT',
  'KYC',
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER',
  'TRADE',
  'INQUIRY',
  'NOTIFICATION',
  'ADMIN',
  'SETTINGS',
  'SYSTEM'
];

const activityLogSchema = new mongoose.Schema(
  {
    // ---- Affected user (target) ----
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
        'TRADE_RESTORED_BY_ADMIN',
        'KYC_APPROVED',
        'KYC_REJECTED',
        'KYC_SUBMITTED',
        'DEPOSIT_APPROVED',
        'DEPOSIT_REJECTED',
        'DEPOSIT_CREATED_BY_ADMIN',
        'DEPOSIT_AMOUNT_EDITED',
        'DEPOSIT_REQUESTED',
        'WITHDRAWAL_APPROVED',
        'WITHDRAWAL_REJECTED',
        'WITHDRAWAL_CREATED_BY_ADMIN',
        'WITHDRAWAL_REQUESTED',
        'TRANSFER_COMPLETED',
        'TRADE_OPENED_BY_ADMIN',
        'TRADE_CLOSED_BY_ADMIN',
        'TRADE_MODIFIED_BY_ADMIN',
        'USER_UPDATED_BY_ADMIN',
        'USER_DELETED_BY_ADMIN',
        'USER_PROFILE_VIEWED',
        'PROFILE_UPDATED',
        'ADMIN_CREATED',
        'ADMIN_UPDATED',
        'ADMIN_DELETED',
        'ACCOUNT_OPENED',
        'INQUIRY_SUBMITTED',
        'INQUIRY_REVIEWED',
        'INQUIRY_CLOSED',
        'PLAN_CREATED',
        'PLAN_UPDATED',
        'PLAN_DELETED',
        'INSTRUMENT_CREATED',
        'INSTRUMENT_UPDATED',
        'INSTRUMENT_DELETED',
        'PAYMENT_METHOD_CREATED',
        'PAYMENT_METHOD_UPDATED',
        'PAYMENT_METHOD_STATUS_CHANGED',
        'PAYMENT_METHOD_DELETED',
        'HOLIDAY_CREATED',
        'HOLIDAY_UPDATED',
        'HOLIDAY_DELETED',
        'CONVERSION_RATES_UPDATED',
        'WITHDRAW_METHODS_UPDATED',
        'BONUS_SETTINGS_UPDATED',
        'BONUS_CREDITED',
        'TRADABLE_FUND_CREDITED',
        'WALLET_ADJUSTED',
        'IB_LEVELS_UPDATED',
        'IB_DASHBOARD_UPDATED',
        'BROKER_RISK_UPDATED',
        'SLIPPAGE_UPDATED',
        'PLAN_SPREAD_UPDATED',
        'SYMBOLS_BULK_ADDED',
        'NOTIFICATION_BROADCAST',
        'NOTIFICATION_SENT',
        'LOGIN_SUCCESS',
        'LOGIN_FAILED',
        'LOGOUT'
      ],
      index: true
    },

    category: {
      type: String,
      enum: ACTIVITY_CATEGORIES,
      default: 'SYSTEM',
      index: true
    },

    description: {
      type: String,
      default: null
    },

    // ---- Actor (who performed) ----
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
    },

    actor_name: {
      type: String,
      default: null
    },

    actor_email: {
      type: String,
      default: null
    },

    actor_role: {
      type: String,
      default: null
    },

    // ---- Target entity ----
    target_entity_type: {
      type: String,
      default: null
    },

    target_entity_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null
    },

    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },

    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED'],
      default: 'SUCCESS',
      index: true
    },

    ip: {
      type: String,
      default: null
    },

    user_agent: {
      type: String,
      default: null
    },

    // ---- Historical identity snapshots (survive user deletion) ----
    user_name: {
      type: String,
      default: null
    },

    user_email: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

activityLogSchema.index({ user_id: 1, createdAt: -1, _id: -1 });
activityLogSchema.index({ createdAt: -1, _id: -1 });
activityLogSchema.index({ actor_id: 1, createdAt: -1 });
activityLogSchema.index({ category: 1, createdAt: -1 });

export { ACTIVITY_CATEGORIES };
export default mongoose.model('ActivityLog', activityLogSchema);
