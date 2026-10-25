import {
  createDepositService,
  getUserDepositsService,
  getDepositStatusService,
  adminGetAllDepositsService,
  adminSearchDepositsService,
  approveDepositService,
  rejectDepositService,
  editDepositAmountService,
  adminCreateDepositService
} from '../services/deposit.service.js';

/* USER: CREATE DEPOSIT */
export async function createDeposit(req, res) {
  try {
    const deposit = await createDepositService({
      userId: req.user._id,
      ...req.body,
      ipAddress: req.ip
    });

    return res.status(201).json({
      success: true,
      message: 'Deposit request submitted',
      data: deposit
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

/* USER: GET OWN DEPOSITS */
export async function getMyDeposits(req, res) {
  try {
    const {
      page = 1,
      limit = 10,
      startDate,
      endDate,
      status
    } = req.query;

    const result = await getUserDepositsService({
      userId: req.user._id,
      page: Number(page),
      limit: Number(limit),
      startDate,
      endDate,
      status
    });

    return res.status(200).json({
      success: true,
      data: result.data,
      pagination: result.pagination
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

/* USER: CHECK STATUS */
export async function getDepositStatus(req, res) {
  try {
    const data = await getDepositStatusService(req.user._id, req.params.id);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(404).json({ success: false, message: err.message });
  }
}

/* ADMIN: GET ALL */
export async function adminGetAllDeposits(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const filters = {
      status: req.query.status,
      fromDate: req.query.fromDate,
      toDate: req.query.toDate,
      ...(req.brokerId ? { brokerId: req.brokerId } : {}),
    };

    const result = await adminGetAllDepositsService({
      page,
      limit,
      filters
    });

    return res.json({
      success: true,
      page,
      limit,
      total: result.total,
      data: result.records
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

/* ADMIN: SEARCH */
export async function adminSearchDeposits(req, res) {
  try {
    const result = await adminSearchDepositsService({
      ...req.query,
      ...(req.brokerId ? { brokerId: req.brokerId } : {}),
    });

    return res.json({
      success: true,
      data: result.items,
      pagination: result.pagination
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}


/* ADMIN: APPROVE */
export async function adminApproveDeposit(req, res) {
  try {
    const data = await approveDepositService(req.params.id, req.user.id);
    return res.json({
      success: true,
      message: 'Deposit approved',
      data
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

/* ADMIN: REJECT */
export async function adminRejectDeposit(req, res) {
  try {
    const { rejectionReason } = req.body;

    const data = await rejectDepositService(
      req.params.id,
      req.user.id,
      rejectionReason
    );

    return res.json({
      success: true,
      message: 'Deposit rejected',
      data
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}
// edit deposit amount
export async function adminEditDepositAmount(req, res) {
  try {
    const { id } = req.params;        // ✅ route se match
    const { newAmount } = req.body;
    const adminId = req.user._id;

    const result = await editDepositAmountService({
      depositId: id,                  // ✅ service ko sahi value
      newAmount,
      adminId
    });

    return res.json({
      success: true,
      message: 'Deposit amount updated successfully',
      data: result
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message
    });
  }
}

/* ADMIN: CREATE DEPOSIT */
export async function adminCreateDeposit(req, res) {
  try {
    const { accountId, amount, method, dateTime } = req.body;
    const proof = req.body?.proof;
    const parsedAmount =
      typeof amount === "number" ? amount : Number(amount);
    const ipAddress =
      req.ip ||
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      "127.0.0.1";

    const deposit = await adminCreateDepositService({
      accountId,
      amount: parsedAmount,
      method,
      dateTime,
      proof,
      adminId: req.user._id,
      ipAddress,
    });

    return res.status(201).json({
      success: true,
      message: 'Deposit created by admin',
      data: deposit
    });
  } catch (err) {
    console.error("[ADMIN_DEPOSIT]", err?.message || err);
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

