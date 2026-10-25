import mongoose from 'mongoose';

const paymentMethodSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['BANK', 'UPI', 'CRYPTO', 'INTERNATIONAL'],
      required: true,
      index: true
    },

    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Broker',
      default: null,
      index: true,
    },

    title: {
      type: String,
      required: true
    },

    // BANK
    bank_name: String,
    account_name: String,
    account_number: String,
    ifsc: String,
    swift_code: String,

    // UPI
    upi_id: String,

    // CRYPTO
    crypto_network: String,
    crypto_address: String,

    // INTERNATIONAL (Neteller/Skrill)
    international_name: String,
    international_email: String,

    // Conversion settings (manual rate to USDT)
    conversion_currency: {
      type: String,
      default: ''
    },
    conversion_rate: {
      type: Number,
      default: null
    },

    // IMAGE (Cloudinary)
    image_url: {
      type: String,
      default: ''
    },

    image_public_id: {
      type: String,
      default: '',
      index: true
    },

    is_active: {
      type: Boolean,
      default: true,
      index: true
    },

    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
  },
  { timestamps: true }
);

paymentMethodSchema.index({ is_active: 1, type: 1 });

export default mongoose.model('PaymentMethod', paymentMethodSchema);
