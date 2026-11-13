import {
  getSlippageSettingsService,
  upsertSlippageSettingsService,
} from "../services/slippage.service.js";

export async function adminGetSlippageSettings(req, res) {
  try {
    const data = await getSlippageSettingsService();
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminUpdateSlippageSettings(req, res) {
  try {
    const {
      enabled,
      mode,
      fixed_points,
      min_points,
      max_points,
      apply_market_orders,
      apply_stop_orders,
      apply_close,
      direction,
    } = req.body || {};

    const data = await upsertSlippageSettingsService(
      {
        enabled,
        mode,
        fixed_points,
        min_points,
        max_points,
        apply_market_orders,
        apply_stop_orders,
        apply_close,
        direction,
      },
      { updatedBy: req.user?._id || null },
    );

    return res.status(200).json({
      success: true,
      message: "Slippage settings updated",
      data,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}
