import {
  getIbCommissionSummaryForIb,
  listIbCommissionsAdmin,
  listIbCommissionReportForIb,
  withdrawIbCommissionService,
} from "../services/ibCommission.service.js";

export async function listIbCommissionsAdminController(req, res) {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    const data = await listIbCommissionsAdmin({
      brokerId: req.brokerId || null,
      ibUserId: req.query.ibUserId || null,
      page,
      limit,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}

export async function getMyIbCommissionSummaryController(req, res) {
  try {
    const data = await getIbCommissionSummaryForIb(req.user._id);
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}

export async function withdrawMyIbCommissionController(req, res) {
  try {
    const { amount, method, payout } = req.body || {};
    const data = await withdrawIbCommissionService({
      userId: req.user._id,
      amount: Number(amount),
      method,
      payout,
      ipAddress: req.ip || req.headers["x-forwarded-for"] || "",
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}

export async function listMyIbCommissionsController(req, res) {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    const data = await listIbCommissionReportForIb(req.user._id, {
      q: req.query.q || "",
      from: req.query.from || "",
      to: req.query.to || "",
      level: req.query.level || "",
      page,
      limit,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}
