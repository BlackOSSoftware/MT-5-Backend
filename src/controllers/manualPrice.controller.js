import {
  executeManualPrice,
  listManualPriceEvents,
} from "../services/manualPrice.service.js";

/**
 * This feature is restricted to ONE admin account.
 * Backend-enforced — frontend visibility is only a convenience.
 */
const ALLOWED_ADMIN_EMAIL = "admin@oceanaprofx.com";

function isAllowedAdmin(req) {
  return String(req.user?.email || "").trim().toLowerCase() === ALLOWED_ADMIN_EMAIL;
}

function forbidden(res) {
  return res.status(403).json({
    success: false,
    message: "This feature is not available for your account",
  });
}

/**
 * POST /api/v1/trade-admin/manual-price
 * Body: { symbol: "XAUUSD", price: 4000 }
 */
export async function adminManualPrice(req, res) {
  try {
    if (!isAllowedAdmin(req)) return forbidden(res);

    const brokerId = req.brokerId ? String(req.brokerId) : null;
    if (!brokerId) {
      return res.status(400).json({
        success: false,
        message: "Broker scope required",
      });
    }

    const { symbol, price } = req.body || {};
    if (!symbol || price === undefined || price === null) {
      return res.status(400).json({
        success: false,
        message: "symbol and price are required",
      });
    }

    const result = await executeManualPrice({
      adminUser: req.user,
      brokerId,
      symbol: String(symbol),
      price,
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) {
      console.error("[MANUAL_PRICE] execute failed", err);
    }
    return res.status(status).json({
      success: false,
      message: err?.message || "Manual price update failed",
    });
  }
}

/**
 * GET /api/v1/trade-admin/manual-price/events?symbol=XAUUSD&limit=50
 */
export async function adminManualPriceEvents(req, res) {
  try {
    if (!isAllowedAdmin(req)) return forbidden(res);

    const brokerId = req.brokerId ? String(req.brokerId) : null;
    if (!brokerId) {
      return res.status(400).json({
        success: false,
        message: "Broker scope required",
      });
    }

    const events = await listManualPriceEvents({
      brokerId,
      symbol: req.query?.symbol,
      limit: req.query?.limit,
    });

    return res.json({ success: true, data: events });
  } catch (err) {
    console.error("[MANUAL_PRICE] list events failed", err);
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to load manual price events",
    });
  }
}
