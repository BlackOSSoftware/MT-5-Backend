import {
  createWithdrawal,
  listUserWithdrawals,
  listAdminWithdrawals,
  adminSearchWithdrawals,
  adminApproveWithdrawal,
  adminRejectWithdrawal,
  adminCreateWithdrawal,
} from "../services/withdrawal.service.js";

export const createWithdrawalRequestController = async (req, res) => {
  const result = await createWithdrawal({
    userId: req.user._id,
    ipAddress: req.ip || "",
    payload: req.body,
  });

  return res.status(result.statusCode).json({
    success: result.ok,
    message: result.message || "OK",
    data: result.data || null,
  });
};

export const listUserWithdrawalsController = async (req, res) => {
  const result = await listUserWithdrawals({
    userId: req.user._id,
    query: req.query,
  });

  return res.status(result.statusCode).json({
    success: result.ok,
    data: result.data,
  });
};

export const listAdminWithdrawalsController = async (req, res) => {
  const result = await listAdminWithdrawals({
    query: {
      ...req.query,
      ...(req.brokerId ? { brokerId: req.brokerId } : {}),
    },
  });

  return res.status(result.statusCode).json({
    success: result.ok,
    data: result.data,
  });
};

export const adminSearchWithdrawalsController = async (req, res) => {
  const result = await adminSearchWithdrawals({
    query: req.query
  });

  return res.status(result.statusCode).json({
    success: result.ok,
    message: result.message || undefined,
    data: result.data || null
  });
};

export const adminApproveWithdrawalController = async (req, res) => {
  const result = await adminApproveWithdrawal({
    adminId: req._id,
    withdrawalId: req.params.withdrawalId,
  });

  return res.status(result.statusCode).json({
    success: result.ok,
    message: result.message,
    data: result.data || null,
  });
};

export const adminRejectWithdrawalController = async (req, res) => {
  const { rejectionReason } = req.body;

  const result = await adminRejectWithdrawal({
    adminId: req._id,
    withdrawalId: req.params.withdrawalId,
    rejectionReason,
  });

  return res.status(result.statusCode).json({
    success: result.ok,
    message: result.message,
    data: result.data || null,
  });
};

export const adminCreateWithdrawalController = async (req, res) => {
  const result = await adminCreateWithdrawal({
    adminId: req.user?._id,
    ipAddress: req.ip || "",
    payload: req.body,
  });

  return res.status(result.statusCode).json({
    success: result.ok,
    message: result.message || "OK",
    data: result.data || null,
  });
};
