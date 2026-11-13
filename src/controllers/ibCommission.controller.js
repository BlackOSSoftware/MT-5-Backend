import {
  listIbCommissionsAdmin,
  listIbCommissionsForIbUser,
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

export async function listMyIbCommissionsController(req, res) {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    const data = await listIbCommissionsForIbUser(req.user._id, {
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
