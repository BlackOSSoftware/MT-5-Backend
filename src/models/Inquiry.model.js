import mongoose from 'mongoose';

const INQUIRY_STATUSES = ['OPEN', 'REVIEWED', 'CLOSED'];

const inquirySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: 150
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    ip: {
      type: String,
      required: true
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },

    status: {
      type: String,
      enum: INQUIRY_STATUSES,
      default: 'OPEN',
      index: true,
    },

    adminNote: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: '',
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    closedAt: {
      type: Date,
      default: null,
    },

    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Broker',
      default: null,
      index: true,
    },
  },
  {
    timestamps: true
  }
);

inquirySchema.index({ createdAt: -1 });
inquirySchema.index({ email: 1, createdAt: -1 });

export const INQUIRY_STATUS_LIST = INQUIRY_STATUSES;
export default mongoose.model('Inquiry', inquirySchema);
