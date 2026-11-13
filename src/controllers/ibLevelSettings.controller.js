import {
  getIbLevelSettings,
  upsertIbLevelSettings,
} from "../services/ibLevelSettings.service.js";

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
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}
