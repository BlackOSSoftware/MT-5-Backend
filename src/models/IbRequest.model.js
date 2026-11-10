import mongoose from "mongoose";

/**
 * A client asks their direct referrer (IB) to become a Sub-IB.
 * The IB approves/rejects from the IB dashboard -> Client Network -> Sub-IB Requests.
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
      required: true,
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

export default mongoose.model("IbRequest", IbRequestSchema);
