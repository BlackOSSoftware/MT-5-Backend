import {
  adminListSwapDeductionsService,
  getAdminUserTransactionHistoryService,
  getUserTransactionHistoryService
} from '../services/transaction.service.js';

/**
 * GET USER TRANSACTION HISTORY
 */
export async function getUserTransactionHistory(req, res) {
  try {
    const userId = req.user._id;

    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const accountId = req.query.accountId || null;
    const type = req.query.type || null;
    const status = req.query.status || null;

    // Date filters (YYYY-MM-DD)
    const fromDate = req.query.fromDate || null;
    const toDate = req.query.toDate || null;

    const result = await getUserTransactionHistoryService({
      userId,
      accountId,
      page,
      limit,
      type,
      status,
      fromDate,
      toDate
    });

    return res.json({
      success: true,
      message: 'Transaction history fetched successfully',
      ...result
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * ADMIN: GET USER TRANSACTION HISTORY
 */
export async function adminGetUserTransactionHistory(req, res) {
  try {
    const { userId } = req.params;

    const page = Number(req.query.page) || 1;
    const limit = Math.min(Number(req.query.limit) || 20, 200);

    const accountId = req.query.accountId || null;
    const type = req.query.type || null;
    const status = req.query.status || null;
    const referenceType = req.query.referenceType || null;
    const referenceId = req.query.referenceId || null;

    const fromDate = req.query.fromDate || null;
    const toDate = req.query.toDate || null;

    const sortBy = req.query.sortBy || "createdAt";
    const sortDir = req.query.sortDir || "desc";

    if (req.brokerId) {
      const { assertUserBelongsToBroker } = await import("../utils/brokerScope.js");
      await assertUserBelongsToBroker(userId, req.brokerId);
    }

    const result = await getAdminUserTransactionHistoryService({
      userId,
      accountId,
      page,
      limit,
      type,
      status,
      referenceType,
      referenceId,
      fromDate,
      toDate,
      sortBy,
      sortDir
    });

    return res.json({
      success: true,
      message: 'Admin transaction history fetched successfully',
      ...result
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

/**
 * ADMIN: LIST SWAP DEDUCTIONS (GLOBAL)
 * GET /api/v1/transactions/admin/swap
 */
export async function adminListSwapDeductions(req, res) {
  try {
    const { withBrokerQuery } = await import("../utils/brokerScope.js");
    const result = await adminListSwapDeductionsService({
      query: withBrokerQuery(req, req.query),
    });

    return res.json({
      success: true,
      message: 'Swap deductions fetched successfully',
      data: result.data,
      summary: result.summary,
      pagination: result.pagination
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error?.message || 'Failed to fetch swap deductions'
    });
  }
}
