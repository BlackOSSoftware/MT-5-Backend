import cron from 'node-cron';
import { MarketSchedule } from '../models/MarketSchedule.model.js';
import { marketService } from '../services/market.service.js';
import { tradeEngine } from '../trade-engine/bootstrap.js';
import { broadcastMarketStatus } from '../ws/alltick.ws.js';

export const startMarketCron = () => {
  // Track changes to avoid noisy logs every minute.
  const lastBySegment = new Map(); // seg -> { isMarketOpen, reason, openTime, closeTime, timezone }

  const run = async () => {
    try {
      // Collect segments from DB schedules + currently loaded engine symbols.
      // This avoids "missing status" for a segment that exists in instruments but doesn't have a schedule doc yet.
      const schedules = await MarketSchedule.find({}).select('segment').lean();

      const segmentSet = new Set();
      for (const s of schedules) {
        if (s?.segment) segmentSet.add(String(s.segment));
      }
      for (const sym of tradeEngine.symbols.values()) {
        if (sym?.segment) segmentSet.add(String(sym.segment));
      }

      for (const seg of segmentSet) {
        // Force refresh so status stays accurate with time (open/close window).
        const res = await marketService.refreshMarketStatus(seg);
        if (res?.data) {
          // Keep an in-process snapshot for ultra-fast checks inside trade-engine (no Redis on order path).
          tradeEngine.setMarketStatus(res.data.segment, res.data);

          // Log only when status changes (open/close/reason/timing).
          const prev = lastBySegment.get(res.data.segment);
          const next = {
            isMarketOpen: res.data.isMarketOpen,
            reason: res.data.reason,
            openTime: res.data.openTime,
            closeTime: res.data.closeTime,
            timezone: res.data.timezone,
          };

          const changed =
            !prev ||
            prev.isMarketOpen !== next.isMarketOpen ||
            prev.reason !== next.reason ||
            prev.openTime !== next.openTime ||
            prev.closeTime !== next.closeTime ||
            prev.timezone !== next.timezone;

          if (changed) {
            console.log('[MARKET_CRON] status:', {
              segment: res.data.segment,
              ...next,
              lastCheckedAt: res.data.lastCheckedAt,
            });
            lastBySegment.set(res.data.segment, next);
            // Quotes UI: closed symbols gray bid/ask
            broadcastMarketStatus(res.data);
          }
        }
      }
    } catch (err) {
      console.error('Market cron error:', err);
    }
  };

  // Run once immediately so the engine has market status on startup (no 1-minute gap).
  run();

  cron.schedule('* * * * *', run);

  console.log('Market cron started: every minute');
};
