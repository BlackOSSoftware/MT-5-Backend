import {
  getBonusSettingsService,
  upsertBonusSettingsService,
  adminCreditBonusService,
  adminCreditTradableFundService,
} from "../services/bonus.service.js";
import { assertUserBelongsToBroker } from "../utils/brokerScope.js";

export async function adminGetBonusSettings(req, res) {
  try {
    const data = await getBonusSettingsService();
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminUpdateBonusSettings(req, res) {
  try {
    const { bonus_enabled, default_bonus_percent } = req.body || {};
    const data = await upsertBonusSettingsService({
      bonus_enabled,
      default_bonus_percent,
      updatedBy: req.user?._id || null,
    });
    return res.status(200).json({
      success: true,
      message: "Bonus settings updated",
      data,
    });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
}

export async function adminCreditBonus(req, res) {
  try {
    const { userId, accountId, amount, bonusAmount, reason } = req.body || {};
    if (req.brokerId) {
      await assertUserBelongsToBroker(userId, req.brokerId);
    }
    const data = await adminCreditBonusService({
      adminId: req.user?._id || null,
      userId,
      accountId,
      amount: Number(amount),
      bonusAmount: Number(bonusAmount),
      reason,
    });
    return res.status(200).json({
      success: true,
      message: "Bonus added successfully",
      data,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}

export async function adminCreditTradableFund(req, res) {
  try {
    const { userId, accountId, amount, tradableFundAmount, reason } = req.body || {};
    if (req.brokerId) {
      await assertUserBelongsToBroker(userId, req.brokerId);
    }
    const data = await adminCreditTradableFundService({
      adminId: req.user?._id || null,
      userId,
      accountId,
      amount: Number(amount),
      tradableFundAmount: Number(tradableFundAmount),
      reason,
    });
    return res.status(200).json({
      success: true,
      message: "Tradable fund added successfully",
      data,
    });
  } catch (err) {
    return res.status(err.status || 400).json({ success: false, message: err.message });
  }
}
