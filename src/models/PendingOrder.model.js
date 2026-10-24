import mongoose from "mongoose";

const PendingOrderSchema = new mongoose.Schema(
  {
    /* =========================
       OWNERSHIP / SECURITY
    ========================== */

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Account",
      required: true,
      index: true,
    },

    /* =========================
       ORDER IDENTITY
    ========================== */

    /** Engine generated order id */
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    ticket: { type: Number, unique: true, sparse: true },

    symbol: {
      type: String,
      required: true,
      index: true,
    },

    side: {
      type: String,
      enum: ["BUY", "SELL"],
      required: true,
    },

    /** Pending order types only */
    orderType: {
      type: String,
      enum: [
        "BUY_LIMIT",
        "SELL_LIMIT",
        "BUY_STOP",
        "SELL_STOP",
        "BUY_STOP_LIMIT",
        "SELL_STOP_LIMIT",
      ],
      required: true,
      index: true,
    },

    /* =========================
       PRICE & VOLUME
    ========================== */

    /** Trigger price */
    price: {
      type: Number,
      required: true,
    },

    /** Limit price for STOP_LIMIT orders (null otherwise) */
    limitPrice: {
      type: Number,
      default: null,
    },

    volume: {
      type: Number,
      required: true,
      min: 0,
    },

    /* =========================
       STOP LOSS / TAKE PROFIT
    ========================== */

    stopLoss: {
      type: Number,
      default: null,
    },

    takeProfit: {
      type: Number,
      default: null,
    },

    /* =========================
       LIFECYCLE
    ========================== */

    status: {
      type: String,
      enum: ["PENDING", "EXECUTED", "CANCELLED", "EXPIRED"],
      default: "PENDING",
      index: true,
    },

    /** When order converted to trade */
    executedAt: {
      type: Date,
      default: null,
    },

    /** Trade positionId created from this order */
    executedPositionId: {
      type: String,
      default: null,
      index: true,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    /** GTC = Good Till Cancelled (kabhi expire nahi), TODAY /
     *  SPECIFIED / SPECIFIED_DAY ke saath expireAt bhi ayega. */
    expireType: {
      type: String,
      enum: ["GTC", "TODAY", "SPECIFIED", "SPECIFIED_DAY"],
      default: "GTC",
    },

    expireAt: {
      type: Date,
      default: null,
    },

    /* =========================
       AUDIT / META
    ========================== */

    engineVersion: {
      type: String,
      default: "ENGINE_V1",
    },

    metadata: {
      type: Object,
      default: {},
    },

    /* =========================
       ADMIN SOFT DELETE
    ========================== */
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    deleteBalanceDelta: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/* =========================
   🔥 PERFORMANCE INDEXES
========================== */

PendingOrderSchema.index({ accountId: 1, status: 1 });
PendingOrderSchema.index({ userId: 1, createdAt: -1 });
PendingOrderSchema.index({ symbol: 1, status: 1 });
PendingOrderSchema.index({ orderType: 1, status: 1 });
PendingOrderSchema.index({ expireAt: 1 });
PendingOrderSchema.index({ status: 1, createdAt: -1 });
PendingOrderSchema.index({ isDeleted: 1, deletedAt: -1 });

const PendingOrder = mongoose.model("PendingOrder", PendingOrderSchema);
export default PendingOrder;
