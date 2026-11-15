import mongoose from "mongoose";

/**
 * IB dashboard access request.
 * - type SUB_IB: a referred client asks their direct referrer (IB) to approve.
 * - type ADMIN: a direct-signup client (no referrer) asks the admin team.
 * The IB approves/rejects SUB_IB requests from IB dashboard -> Client Network -> Sub-IB Requests.
 * Admin can review/respond to ALL requests from the admin panel.
 */
const IbRequestSchema = new mongoose.Schema(
  {
    requester: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    ib: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: ["SUB_IB", "ADMIN"],
      default: "SUB_IB",
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
      index: true,
    },
    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    respondedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

IbRequestSchema.index({ ib: 1, status: 1, createdAt: -1 });
IbRequestSchema.index({ requester: 1, status: 1 });
IbRequestSchema.index({ type: 1, status: 1, createdAt: -1 });

export default mongoose.model("IbRequest", IbRequestSchema);
