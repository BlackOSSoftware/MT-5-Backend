import { getCandles, listTimeframes, getManualPriceEvents } from "./chart.service.js";
import { parseCandlesQuery } from "./chart.validator.js";
import Account from "../../models/Account.model.js";

export async function getCandlesController(req, res) {
  try {
    const query = parseCandlesQuery(req.query);
    const data = await getCandles(query);
    return res.json({ status: "success", data });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error("[CHART] candles failed:", err?.message);
    return res.status(status).json({
      status: "error",
      message: err?.message || "Failed to load chart",
    });
  }
}

export function getTimeframesController(_req, res) {
  return res.json({ status: "success", data: listTimeframes() });
}

/**
 * GET /chart/manual-price-events?symbol=XAUUSD
 * Trade-token auth (accountAuthMiddleware). Returns broker-scoped manual
 * price events so the web chart can retain the movement in history.
 */
export async function getManualPriceEventsController(req, res) {
  try {
    const accountId = req.account?.accountId;
    if (!accountId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const account = await Account.findById(accountId).select("brokerId").lean();
    if (!account?.brokerId) {
      return res.json({ status: "success", data: { events: [] } });
    }
    const symbol = String(req.query?.symbol || "").trim();
    const events = await getManualPriceEvents({
      brokerId: account.brokerId,
      symbol,
    });
    return res.json({ status: "success", data: { events } });
  } catch (err) {
    console.error("[CHART] manual-price-events failed:", err?.message);
    return res.status(500).json({
      status: "error",
      message: err?.message || "Failed to load manual price events",
    });
  }
}
