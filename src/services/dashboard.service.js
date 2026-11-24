import User from "../models/User.model.js";
import Deposit from "../models/Deposit.model.js";
import Withdrawal from "../models/Withdrawal.model.js";
import { applyBrokerUserIdMatch } from "../utils/brokerScope.js";

/**
 * Admin dashboard overview stats.
 * Broker admins see only their own users/deposits/withdrawals;
 * SuperAdmin (no brokerId) sees everything.
 */
export async function adminDashboardStatsService(brokerId = null) {
  const userFilter = { userType: "USER" };
  if (brokerId) userFilter.brokerId = brokerId;

  const depositMatch = { status: "APPROVED" };
  await applyBrokerUserIdMatch(depositMatch, brokerId, "user");

  const withdrawalMatch = { status: "COMPLETED" };
  await applyBrokerUserIdMatch(withdrawalMatch, brokerId, "user");

  const [userCount, kycRows, depositRows, withdrawalRows] = await Promise.all([
    User.countDocuments(userFilter),

    User.aggregate([
      { $match: userFilter },
      { $group: { _id: "$kycStatus", count: { $sum: 1 } } },
    ]),

    Deposit.aggregate([
      { $match: depositMatch },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),

    Withdrawal.aggregate([
      { $match: withdrawalMatch },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);

  const kyc = { verified: 0, pending: 0, rejected: 0, notStarted: 0 };
  for (const row of kycRows) {
    const status = String(row._id || "").toUpperCase();
    if (status === "VERIFIED") kyc.verified = row.count;
    else if (status === "PENDING") kyc.pending = row.count;
    else if (status === "REJECTED") kyc.rejected = row.count;
    else kyc.notStarted += row.count;
  }

  const deposit = depositRows[0] || { total: 0, count: 0 };
  const withdrawal = withdrawalRows[0] || { total: 0, count: 0 };

  return {
    totalUsers: userCount,
    kyc,
    totalDeposit: Number(deposit.total || 0),
    depositCount: deposit.count || 0,
    totalWithdraw: Number(withdrawal.total || 0),
    withdrawCount: withdrawal.count || 0,
  };
}
