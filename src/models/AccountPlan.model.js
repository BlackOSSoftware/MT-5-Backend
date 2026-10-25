import mongoose from 'mongoose';

const AccountPlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      // unique per broker (compound index below) — legacy global unique removed
    },

    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      default: null,
      index: true,
    },

    // ✅ DEFAULT PLAN SPREAD (PIPS)
    spreadPips: {
      type: Number,
      default: 0.0 // 0.0 = market pricing
    },

    // ✅ PLAN LEVEL SPREAD ENABLE / DISABLE
    spread_enabled: {
      type: Boolean,
      default: true // true = spread ON, false = spread OFF
    },

    commission: {
      type: Number,
      default: 0 // per lot
    },

    leverageNote: {
      type: String,
      default: 'Unlimited'
    },

    max_leverage: {
      type: Number,
      default: 0 // 0 = unlimited, otherwise numeric limit
    },

    minLotSize: {
      type: Number,
      default: 0.01
    },

    minDeposit: {
      type: Number,
      default: 0
    },

    guidance: {
      type: String,
      default: ''
    },

    is_demo_allowed: {
      type: Boolean,
      default: false
    },

    commission_per_lot: {
      type: Number,
      default: 0
    },

    swap_enabled: {
      type: Boolean,
      default: true
    },

    // ✅ SINGLE SWAP CHARGE (Buy/Sell Same)
    swap_charge: {
      type: Number,
      default: 0, // per lot per day
      min: 0
    },

    // ✅ REFERRAL REWARD AMOUNT
    referral_reward_amount: {
      type: Number,
      default: 0 // amount credited when referral is successful
    },

    isActive: {
      type: Boolean,
      default: true
    }
  },
  {
    timestamps: true,
    versionKey: false
  }
);

// Plan name unique per broker (null broker = legacy until migrate).
AccountPlanSchema.index(
  { brokerId: 1, name: 1 },
  { unique: true, name: "uniq_broker_plan_name" }
);

export default mongoose.model('AccountPlan', AccountPlanSchema);
