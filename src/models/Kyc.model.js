import mongoose from 'mongoose';

const kycSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true
    },

    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Broker',
      default: null,
      index: true,
    },

    // Who created/updated this KYC record
    // USER: submitted by user with documents
    // ADMIN: created/overridden by admin (documents may be empty)
    source: {
      type: String,
      enum: ['USER', 'ADMIN'],
      default: 'USER',
      index: true
    },

    documentType: {
      type: String,
      enum: ['NIC', 'PASSPORT', 'DRIVING_LICENSE', 'ELECTRICITY_BILL'],
      required: false,
      index: true
    },

    documents: {
      front: {
        image_url: { type: String, default: '' },
        image_public_id: { type: String, default: '' }
      },
      back: {
        image_url: { type: String, default: '' },
        image_public_id: { type: String, default: '' }
      },
      selfie: {
        image_url: { type: String, default: '' },
        image_public_id: { type: String, default: '' }
      }
    },

    status: {
      type: String,
      enum: ['PENDING', 'VERIFIED', 'REJECTED'],
      default: 'PENDING',
      index: true
    },

    rejectionReason: {
      type: String,
      default: ''
    }
  },
  { timestamps: true }
);

export default mongoose.model('Kyc', kycSchema);
