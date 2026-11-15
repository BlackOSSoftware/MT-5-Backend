import {
  ensureBrokerRiskSettings,
  getBrokerRiskSettingsService,
  upsertBrokerRiskSettingsService,
} from "../services/brokerRisk.service.js";
import {
  ACTIVITY_ACTIONS,
  logAdminAction,
} from "../services/activity.service.js";

export async function getAdminBrokerRiskSettings(req, res) {
  try {
    const brokerId = req.brokerId;
    if (!brokerId) {
      return res.status(400).json({
        success: false,
        message: "Select a broker context (x-broker-id) to manage risk settings",
      });
    }
    await ensureBrokerRiskSettings(brokerId);
    const data = await getBrokerRiskSettingsService(brokerId);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Unable to load risk settings",
    });
  }
}

export async function upsertAdminBrokerRiskSettings(req, res) {
  try {
    const brokerId = req.brokerId;
    if (!brokerId) {
      return res.status(400).json({
        success: false,
        message: "Select a broker context (x-broker-id) to manage risk settings",
      });
    }
    const { warning_loss_percent, stop_out_loss_percent } = req.body || {};
    const data = await upsertBrokerRiskSettingsService({
      brokerId,
      warning_loss_percent,
      stop_out_loss_percent,
      updatedBy: req.user?._id || null,
    });
    logAdminAction({
      actorId: req.user?._id || req.user?.id || null,
      action: ACTIVITY_ACTIONS.BROKER_RISK_UPDATED,
      ip: req.ip || req.headers?.["x-forwarded-for"] || null,
    }).catch(() => {});
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Unable to update risk settings",
    });
  }
}
