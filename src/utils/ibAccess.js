import Broker from "../models/Broker.model.js";
import User from "../models/User.model.js";

/** Brokers whose clients only see the IB dashboard after an admin enables it. */
export const IB_GATED_BROKER_CODES = new Set(["OCEANAPROFX"]);

/** Admin logins allowed to enable / disable a client's IB dashboard. */
export const IB_TOGGLE_ADMIN_EMAILS = new Set(["admin@oceanaprofx.com"]);

export function canToggleIbDashboard(adminUser) {
  return IB_TOGGLE_ADMIN_EMAILS.has(String(adminUser?.email || "").trim().toLowerCase());
}

async function brokerCodeOf(brokerId) {
  if (!brokerId) return "";
  const broker = await Broker.findById(brokerId).select("code").lean();
  return String(broker?.code || "").toUpperCase();
}

export function ibAccessFor({ brokerCode, ibDashboardEnabled }) {
  if (!IB_GATED_BROKER_CODES.has(String(brokerCode || "").toUpperCase())) return true;
  return Boolean(ibDashboardEnabled);
}

export async function userHasIbDashboardAccess(userId) {
  const user = await User.findById(userId).select("brokerId ibDashboardEnabled").lean();
  if (!user) return false;
  return ibAccessFor({
    brokerCode: await brokerCodeOf(user.brokerId),
    ibDashboardEnabled: user.ibDashboardEnabled,
  });
}

/** Use after authMiddleware on client IB/referral endpoints. */
export async function requireIbDashboardAccess(req, res, next) {
  try {
    if (await userHasIbDashboardAccess(req.user?._id)) return next();
    return res.status(403).json({
      success: false,
      code: "IB_DASHBOARD_DISABLED",
      message: "IB dashboard is not enabled for your account",
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message || "IB access check failed",
    });
  }
}
