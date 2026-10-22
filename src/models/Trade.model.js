import mongoose from "mongoose";

const TradeSchema = new mongoose.Schema(
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

    ipAddress: {
      type: String,
      required: true,
    },

    /* =========================
       TRADE IDENTITY
    ========================== */

    positionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    ticket: { type: Number, unique: true, sparse: true },

    /** Close (out) order ticket - MT5 me close ek alag order hai. */
    closeTicket: { type: Number, unique: true, sparse: true },

    /** Deal tickets (in / out) - History > Deals me dikhte hain. */
    openDealTicket: { type: Number, unique: true, sparse: true },
    closeDealTicket: { type: Number, unique: true, sparse: true },

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

    orderType: {
      type: String,
      enum: [
        "MARKET",
        "BUY_LIMIT",
        "SELL_LIMIT",
        "BUY_STOP",
        "SELL_STOP",
      ],
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["PENDING", "OPEN", "CLOSED", "CANCELLED"],
      default: "OPEN",
      index: true,
    },

    /* =========================
       TRADE VOLUME & PRICING
    ========================== */

    volume: {
      type: Number,
      required: true,
      min: 0,
    },

    contractSize: {
      type: Number,
      required: true,
    },

    leverage: {
      type: Number,
      required: true,
    },

    openPrice: {
      type: Number,
      required: true,
    },

    entryPrice: {
      type: Number,
      default: null,
    },

    closePrice: {
      type: Number,
      default: null,
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
       MARGIN & PNL (MT5 STYLE)
    ========================== */

    marginUsed: {
      type: Number,
      required: true,
      min: 0,
    },

    /** price movement PnL only */
    grossPnL: {
      type: Number,
      default: 0,
    },

    /** broker commission */
    commission: {
      type: Number,
      default: 0,
    },

    /** spread applied at entry (points/pips, from symbol) */
    spread: {
      type: Number,
      default: 0,
    },

    /** overnight swap (+ / -) */
    swap: {
      type: Number,
      default: 0,
    },

    /** final net PnL */
    realizedPnL: {
      type: Number,
      default: 0,
    },

    /* =========================
       TIME & LIFECYCLE
    ========================== */

    openTime: {
      type: Date,
      required: true,
      index: true,
    },

    closeTime: {
      type: Date,
      default: null,
    },

    closeReason: {
      type: String,
      enum: [
        "MANUAL",
        "STOP_LOSS",
        "TAKE_PROFIT",
        "STOP_OUT",
        "SYSTEM",
        "TRADE",
      ],
      default: null,
    },

    /* =========================
       AUDIT / SAFETY
    ========================== */

    engineVersion: {
      type: String,
      default: "ENGINE_V1",
    },

    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

/* =========================
   PERFORMANCE INDEXES
========================== */

TradeSchema.index({ accountId: 1, status: 1 });
TradeSchema.index({ userId: 1, openTime: -1 });
TradeSchema.index({ symbol: 1, status: 1 });
TradeSchema.index({ orderType: 1, status: 1 });
TradeSchema.index({ positionId: 1 });
TradeSchema.index({ openTime: -1 });
TradeSchema.index({ status: 1, openTime: -1 });
TradeSchema.index({ status: 1, closeTime: -1 });

const Trade = mongoose.model("Trade", TradeSchema);
export default Trade;
