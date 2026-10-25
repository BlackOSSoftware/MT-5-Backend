import {
  submitKycService,
  getUserKycService,
  updateKycStatusService,
  getAdminKycListService
} from '../services/kyc.service.js';
/* USER */
export async function submitKyc(req, res) {
  try {
    const kyc = await submitKycService(req.user._id, req.body);
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
