import {
  getSlippageSettingsService,
  upsertSlippageSettingsService,
} from "../services/slippage.service.js";
import {
  ACTIVITY_ACTIONS,
  logAdminAction,
} from "../services/activity.service.js";

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

    logAdminAction({
      actorId: req.user?._id || req.user?.id || null,
      action: ACTIVITY_ACTIONS.SLIPPAGE_UPDATED,
      ip: req.ip || req.headers?.["x-forwarded-for"] || null,
      userAgent: req.headers?.["user-agent"] || null,
      description: "Slippage settings updated",
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Slippage settings updated",
      data,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}
