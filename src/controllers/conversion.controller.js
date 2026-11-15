import {
  convertAmountService,
  getConversionRatesService,
  upsertConversionRatesService,
} from "../services/conversion.service.js";
import { getUserBrokerId } from "../utils/brokerScope.js";
import {
  ACTIVITY_ACTIONS,
  logAdminAction,
} from "../services/activity.service.js";

async function resolveRequestBrokerId(req) {
  if (req.brokerId) return req.brokerId;
  if (req.user?._id) return getUserBrokerId(req.user._id);
  return null;
}

export async function getConversionRates(req, res) {
  try {
    const brokerId = await resolveRequestBrokerId(req);
    if (!brokerId) {
      return res.status(400).json({
        success: false,
        message: "brokerId is required (send x-broker-id for admin)",
      });
    }

    const data = await getConversionRatesService(brokerId);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
}

export async function upsertConversionRates(req, res) {
  try {
    const brokerId = req.brokerId;
    if (!brokerId) {
      return res.status(400).json({
        success: false,
        message: "brokerId is required (send x-broker-id)",
      });
    }

    const usdtInr =
      req.body?.usdtInr !== undefined ? Number(req.body.usdtInr) : undefined;
    const usdtInrWithdraw =
      req.body?.usdtInrWithdraw !== undefined
        ? Number(req.body.usdtInrWithdraw)
        : undefined;
    const btcUsdt =
      req.body?.btcUsdt !== undefined ? Number(req.body.btcUsdt) : undefined;
    const btcUsdtWithdraw =
      req.body?.btcUsdtWithdraw !== undefined
        ? Number(req.body.btcUsdtWithdraw)
        : undefined;

    const data = await upsertConversionRatesService({
      usdtInr,
      usdtInrWithdraw,
      btcUsdt,
      btcUsdtWithdraw,
      updatedBy: req.user?._id || null,
      brokerId,
    });

    logAdminAction({
      actorId: req.user?._id || req.user?.id || null,
      action: ACTIVITY_ACTIONS.CONVERSION_RATES_UPDATED,
      ip: req.ip || req.headers?.["x-forwarded-for"] || null,
    }).catch(() => {});

    return res.status(200).json({
      success: true,
      message: "Conversion rates updated",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}

export async function convertAmount(req, res) {
  try {
    const brokerId = await resolveRequestBrokerId(req);
    if (!brokerId) {
      return res.status(400).json({
        success: false,
        message: "brokerId is required",
      });
    }

    const amount = Number(req.body?.amount);
    const fromCurrency = req.body?.fromCurrency;
    const toCurrency = req.body?.toCurrency;

    const data = await convertAmountService({
      amount,
      fromCurrency,
      toCurrency,
      brokerId,
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}
