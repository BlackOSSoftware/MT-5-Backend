import {
  getIbLevelSettings,
  upsertIbLevelSettings,
} from "../services/ibLevelSettings.service.js";
import {
  ACTIVITY_ACTIONS,
  logAdminAction,
} from "../services/activity.service.js";

export async function getIbLevelSettingsController(req, res) {
  try {
    const data = await getIbLevelSettings(req.brokerId || null);
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}

export async function upsertIbLevelSettingsController(req, res) {
  try {
    const data = await upsertIbLevelSettings(req.body, {
      brokerId: req.brokerId || null,
    });
    logAdminAction({
      actorId: req.user?._id || req.user?.id || null,
      action: ACTIVITY_ACTIONS.IB_LEVELS_UPDATED,
      ip: req.ip || req.headers?.["x-forwarded-for"] || null,
      userAgent: req.headers?.["user-agent"] || null,
      description: "IB level settings updated",
    }).catch(() => {});
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}
