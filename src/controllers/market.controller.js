import { marketService } from '../services/market.service.js';
import { getMarketStatisticsService } from '../services/marketStatistics.service.js';
import { tradeEngine } from '../trade-engine/bootstrap.js';
import { publishMarketStatus } from '../trade-engine/EngineSyncBus.js';
import { invalidatePropertyCache } from '../services/property.service.js';
import { MarketSchedule } from '../models/MarketSchedule.model.js';

export const getMarketSchedule = async (req, res) => {
  const { segment } = req.params;

  const result = await marketService.getSchedule(segment);
  if (result.error) return res.status(result.error.status).json(result.error);

  return res.json(result.data);
};

export const updateMarketSchedule = async (req, res) => {
  const { segment } = req.params;

  const result = await marketService.updateSchedule(segment, req.body);
  if (result.error) return res.status(result.error.status).json(result.error);

  // Keep the trade-engine in-process cache in sync immediately (no need to wait for cron).
  try {
    const statusRes = await marketService.getMarketStatus(segment);
    if (statusRes?.data) {
      tradeEngine.setMarketStatus(statusRes.data.segment, statusRes.data);
      publishMarketStatus(statusRes.data.segment, statusRes.data);
    }
  } catch (err) {
    console.error("[MARKET] status refresh failed after schedule update", err?.message || err);
  }

  // Property page Quotes/Trades Sessions admin times se sync rahein.
  try {
    await invalidatePropertyCache();
  } catch (err) {
    console.error("[MARKET] property cache invalidate failed", err?.message || err);
  }

  return res.json({ message: 'Schedule updated', data: result.data });
};

export const getMarketStatus = async (req, res) => {
  const { segment } = req.params;

  const debugRaw = String(req.query?.debug || '').trim().toLowerCase();
  const debug = debugRaw === '1' || debugRaw === 'true' || debugRaw === 'yes';

  const result = debug
    ? await marketService.refreshMarketStatus(segment, { debug: true })
    : await marketService.getMarketStatus(segment);
  if (result.error) return res.status(result.error.status).json(result.error);

  return res.json(result.data);
};

export const getMarketStatistics = async (req, res) => {
  try {
    const data = await getMarketStatisticsService(req.params.symbol);
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err?.message || "Failed to load market statistics",
    });
  }
};

/** Saare segments ka open/closed status (quotes UI gray prices ke liye). */
export const getAllMarketStatuses = async (req, res) => {
  try {
    const schedules = await MarketSchedule.find({}).select("segment").lean();
    const segments = schedules.map((s) => s.segment).filter(Boolean);
    // Engine me loaded segments bhi include
    for (const sym of tradeEngine.symbols.values()) {
      if (sym?.segment) segments.push(sym.segment);
    }
    const result = await marketService.getMarketStatusBySegments(segments);
    return res.json({ success: true, data: result.data || {} });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err?.message || "Failed to load market statuses",
    });
  }
};
