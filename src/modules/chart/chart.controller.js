import { getCandles, listTimeframes } from "./chart.service.js";
import { parseCandlesQuery } from "./chart.validator.js";

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
