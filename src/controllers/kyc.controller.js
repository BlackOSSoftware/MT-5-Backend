import {
  submitKycService,
  getUserKycService,
  updateKycStatusService,
  getAdminKycListService
} from '../services/kyc.service.js';
import {
  ACTIVITY_ACTIONS,
  ACTOR_TYPES,
  recordActivity,
} from '../services/activity.service.js';
/* USER */
export async function submitKyc(req, res) {
  try {
    const kyc = await submitKycService(req.user._id, req.body);
    recordActivity({
      userId: req.user._id,
      action: ACTIVITY_ACTIONS.KYC_SUBMITTED,
      actorId: req.user._id,
      actorType: ACTOR_TYPES.SELF,
      ip: req.ip || req.headers?.['x-forwarded-for'] || null,
      userAgent: req.headers?.['user-agent'] || null,
      description: 'KYC submitted',
      targetEntityType: 'kyc',
      targetEntityId: kyc?._id || null,
    }).catch(() => {});
    res.status(201).json({
      success: true,
      message: 'KYC submitted successfully',
      data: kyc
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function getMyKyc(req, res) {
  try {
    const data = await getUserKycService(req.user._id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
}

/* ADMIN */
export const getAllKycs = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const data = await getAdminKycListService({
      page,
      limit,
      status,
      brokerId: req.brokerId || null,
    });

    res.json({
      success: true,
      data: {
        list: data.list,
        pagination: data.pagination,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};

export async function updateKycStatus(req, res) {
  try {
    const { status, rejectionReason } = req.body;

    const kyc = await updateKycStatusService(
      req.params.kycId,
      status,
      rejectionReason,
      req.brokerId || null,
      {
        actorId: req.user?._id || req.user?.id || null,
        ip: req.ip || req.headers?.['x-forwarded-for'] || null,
      },
    );

    res.json({
      success: true,
      message: `KYC ${status.toLowerCase()} successfully`,
      data: kyc
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message
    });
  }
}
