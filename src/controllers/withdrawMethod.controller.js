import {
  getWithdrawMethodSettingsService,
  upsertWithdrawMethodSettingsService,
} from "../services/withdrawMethod.service.js";
import { getUserBrokerId } from "../utils/brokerScope.js";

export async function getAdminWithdrawMethods(req, res) {
  try {
    if (!req.brokerId) {
      return res.status(400).json({
        success: false,
        message: "brokerId is required (send x-broker-id)",
      });
    }

    const data = await getWithdrawMethodSettingsService(req.brokerId);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load withdraw methods",
    });
  }
}

export async function upsertAdminWithdrawMethods(req, res) {
  try {
    if (!req.brokerId) {
      return res.status(400).json({
        success: false,
        message: "brokerId is required (send x-broker-id)",
      });
    }

    const data = await upsertWithdrawMethodSettingsService({
      brokerId: req.brokerId,
      methods: req.body?.methods,
      updatedBy: req.user?._id || null,
    });

    return res.status(200).json({
      success: true,
      message: "Withdraw methods updated",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message || "Failed to update withdraw methods",
    });
  }
}

/** Authenticated user — only enabled methods for their broker. */
export async function getUserWithdrawMethods(req, res) {
  try {
    let brokerId = req.user?.brokerId || null;
    if (!brokerId && req.user?._id) {
      brokerId = await getUserBrokerId(req.user._id);
    }
    if (!brokerId) {
      return res.status(400).json({
        success: false,
        message: "brokerId is required",
      });
    }

    const full = await getWithdrawMethodSettingsService(brokerId);
    return res.status(200).json({
      success: true,
      data: {
        brokerId: full.brokerId,
        enabledMethods: full.enabledMethods,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Failed to load withdraw methods",
    });
  }
}
