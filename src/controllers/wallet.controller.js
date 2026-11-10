import {
  getWalletService,
  listWalletTransactionsService,
  transferWalletService,
  requestWalletWithdrawalService,
  listUserWalletWithdrawalsService,
  adminAdjustWalletService,
} from "../services/wallet.service.js";

function getSafeError(err, fallbackMessage) {
  if (err && typeof err === "object" && err.isPublic) {
    const statusCode =
      Number.isFinite(Number(err.statusCode)) && Number(err.statusCode) >= 400
        ? Number(err.statusCode)
        : 400;
    return { statusCode, message: err.message || fallbackMessage };
  }
  console.error("[WALLET] error:", err);
  return { statusCode: 500, message: fallbackMessage };
}

function fail(res, err, fallback) {
  const safe = getSafeError(err, fallback);
  return res.status(safe.statusCode).json({
    success: false,
    message: safe.message,
  });
}

export async function getWalletController(req, res) {
  try {
    const data = await getWalletService({ userId: req.user._id });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err, "Failed to fetch wallet");
  }
}

export async function listWalletTransactionsController(req, res) {
  try {
    const { page, limit } = req.query;
    const result = await listWalletTransactionsService({
      userId: req.user._id,
      page: Number(page),
      limit: Number(limit),
    });
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    return fail(res, err, "Failed to fetch wallet transactions");
  }
}

export async function transferWalletController(req, res) {
  try {
    const { direction, accountId, amount } = req.body;
    const result = await transferWalletService({
      userId: req.user._id,
      direction,
      accountId,
      amount: Number(amount),
      ipAddress: req.ip,
    });
    return res.status(201).json({
      success: true,
      message: "Wallet transfer completed successfully",
      data: result,
    });
  } catch (err) {
    return fail(res, err, "Wallet transfer failed");
  }
}

export async function requestWalletWithdrawalController(req, res) {
  try {
    const { amount, method, payout } = req.body;
    const result = await requestWalletWithdrawalService({
      userId: req.user._id,
      amount: Number(amount),
      method,
      payout,
      ipAddress: req.ip,
    });
    return res.status(201).json(result);
  } catch (err) {
    return fail(res, err, "Wallet withdrawal request failed");
  }
}

export async function listUserWalletWithdrawalsController(req, res) {
  try {
    const { page, limit } = req.query;
    const result = await listUserWalletWithdrawalsService({
      userId: req.user._id,
      page: Number(page),
      limit: Number(limit),
    });
    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    return fail(res, err, "Failed to fetch wallet withdrawals");
  }
}

export async function adminAdjustWalletController(req, res) {
  try {
    const { userId, amount, direction, remark } = req.body;
    const result = await adminAdjustWalletService({
      adminId: req.user._id,
      userId,
      amount: Number(amount),
      direction,
      remark,
      ipAddress: req.ip,
    });
    return res.status(200).json({
      success: true,
      message: "Wallet adjusted successfully",
      data: result,
    });
  } catch (err) {
    return fail(res, err, "Wallet adjustment failed");
  }
}
