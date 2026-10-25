import KycModel from '../models/Kyc.model.js';
import UserModel from '../models/User.model.js';
import cloudinary from '../config/cloudinary.js';
import { sendUserNotification } from './notification.service.js';
/* ===============================
   SUBMIT KYC
================================ */
export async function submitKycService(userId, payload) {
  const user = await UserModel.findById(userId);
  if (!user) throw new Error('User not found');

  if (user.kycStatus === 'PENDING') {
    throw new Error('KYC already under review');
  }

  if (user.kycStatus === 'VERIFIED') {
    throw new Error('KYC already verified');
  }

  if (
    !['NIC', 'PASSPORT', 'DRIVING_LICENSE', 'ELECTRICITY_BILL']
      .includes(payload.documentType)
  ) {
    throw new Error('Invalid document type');
  }

  const front = payload.documents?.front;
  const selfie = payload.documents?.selfie;

  if (!front?.image_url || !front?.image_public_id) {
    throw new Error('Front document image is mandatory');
  }

  if (!selfie?.image_url || !selfie?.image_public_id) {
    throw new Error('Selfie image is mandatory');
  }

  const oldKyc = await KycModel.findOne({ user: userId });

  /* ===== REJECTED CASE: DELETE OLD CLOUDINARY FILES ===== */
  if (oldKyc && oldKyc.status === 'REJECTED') {
    const publicIds = [];

    if (oldKyc.documents.front?.image_public_id) {
      publicIds.push(oldKyc.documents.front.image_public_id);
    }

    if (oldKyc.documents.back?.image_public_id) {
      publicIds.push(oldKyc.documents.back.image_public_id);
    }

    if (oldKyc.documents.selfie?.image_public_id) {
      publicIds.push(oldKyc.documents.selfie.image_public_id);
    }

    if (publicIds.length > 0) {
      try {
        await cloudinary.api.delete_resources(publicIds);
      } catch (error) {
        console.error('Cloudinary delete error:', error.message);
      }
    }
  }

  /* ===== DELETE OLD KYC RECORD ===== */
  await KycModel.findOneAndDelete({ user: userId });

  /* ===== CREATE NEW KYC ===== */
  const kyc = await KycModel.create({
    brokerId: user.brokerId || null,
    user: userId,
    source: 'USER',
    documentType: payload.documentType,
    documents: payload.documents,
    status: 'PENDING',
    rejectionReason: ''
  });

  await UserModel.findByIdAndUpdate(userId, {
    kycStatus: 'PENDING'
  });

  return kyc;
}


/* ===============================
   GET USER KYC
================================ */
export async function getUserKycService(userId) {
  const kyc = await KycModel.findOne({ user: userId });

  if (!kyc) {
    return { status: 'NOT_STARTED' };
  }

  return kyc;
}

/* ===============================
   ADMIN – GET ALL KYCS
================================ */
export async function getAdminKycListService({
  page = 1,
  limit = 20,
  status,
  documentType,
  brokerId = null,
}) {
  page = Math.max(Number(page) || 1, 1);
  limit = Math.min(Number(limit) || 20, 100);

  let filter = {};
  if (status) filter.status = status;
  if (documentType) filter.documentType = documentType;

  if (brokerId) {
    const userIds = await UserModel.find({ brokerId }).select("_id").lean();
    filter.user = { $in: userIds.map((u) => u._id) };
  }

  const skip = (page - 1) * limit;

  const [list, total] = await Promise.all([
    KycModel.find(filter)
      .populate("user", "name email phone brokerId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),

    KycModel.countDocuments(filter),
  ]);

  return {
    list,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/* ===============================
   ADMIN – UPDATE STATUS
================================ */
export async function updateKycStatusService(
  kycId,
  status,
  rejectionReason = '',
  brokerId = null,
) {
  if (!['VERIFIED', 'REJECTED'].includes(status)) {
    throw new Error('Invalid KYC status');
  }

  const kyc = await KycModel.findById(kycId);
  if (!kyc) {
    throw new Error('KYC not found');
  }

  if (brokerId) {
    const owner = await UserModel.findById(kyc.user).select("brokerId").lean();
    if (!owner || String(owner.brokerId || "") !== String(brokerId)) {
      throw new Error("KYC not found");
    }
  }

  // 🔒 IMPORTANT: KYC can be updated ONLY if PENDING
  if (kyc.status !== 'PENDING') {
    throw new Error(
      `KYC already ${kyc.status}. Status cannot be changed.`
    );
  }

  // 🔒 REJECTION MUST HAVE A REASON
  if (status === 'REJECTED' && !rejectionReason) {
    throw new Error('Rejection reason is required');
  }

  // Update KYC
  kyc.status = status;
  kyc.rejectionReason = status === 'REJECTED' ? rejectionReason : '';
  await kyc.save();

  // Sync user KYC status
  await UserModel.findByIdAndUpdate(kyc.user, {
    kycStatus: status
  });

  /* ===== SEND NOTIFICATION ===== */
  if (status === 'VERIFIED') {
    await sendUserNotification({
      userId: kyc.user,
      title: 'KYC Approved',
      message: 'Your KYC has been approved successfully.',
      data: {
        type: 'KYC',
        status: 'VERIFIED'
      }
    });
  }

  if (status === 'REJECTED') {
    await sendUserNotification({
      userId: kyc.user,
      title: 'KYC Rejected',
      message:
        rejectionReason ||
        'Your KYC was rejected. Please re-submit your documents.',
      data: {
        type: 'KYC',
        status: 'REJECTED'
      }
    });
  }

  return kyc;
}

