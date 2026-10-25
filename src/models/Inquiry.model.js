import mongoose from 'mongoose';

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

/**
 * Indexes for fast pagination & sorting
 */
inquirySchema.index({ createdAt: -1 });

export default mongoose.model('Inquiry', inquirySchema);
