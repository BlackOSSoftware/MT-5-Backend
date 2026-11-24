import { adminDashboardStatsService } from "../services/dashboard.service.js";

export async function adminDashboardStats(req, res) {
  try {
    const data = await adminDashboardStatsService(req.brokerId || null);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}
