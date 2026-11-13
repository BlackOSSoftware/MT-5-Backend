import cron from "node-cron";
import Trade from "../models/Trade.model.js";
import IbCommission from "../models/IbCommission.model.js";
import { creditIbOnFill } from "../services/ibCommission.service.js";

/**
 * Safety net: if creditIbOnFill was missed (e.g. process restart between
 * order fill and async credit), reconcile recent trades that have no
 * IbCommission rows at all.
 */
async function reconcile() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const trades = await Trade.find({
    openTime: { $gte: since },
    positionId: { $exists: true, $ne: null },
  })
    .select("positionId accountId symbol lots volume userId openTime")
    .sort({ openTime: -1 })
    .limit(200)
    .lean();

  if (!trades.length) return;

  const tradeIds = trades.map((t) => String(t.positionId));
  const existing = await IbCommission.find({
    trade_id: { $in: tradeIds },
  })
    .select("trade_id")
    .lean();
  const covered = new Set(existing.map((r) => String(r.trade_id)));

  let credited = 0;
  for (const t of trades) {
    const tid = String(t.positionId);
    if (covered.has(tid)) continue;

    const lots = Number(t.lots ?? t.volume ?? 0);
    if (!(lots > 0)) continue;

    try {
      const res = await creditIbOnFill({
        tradeId: tid,
        positionId: tid,
        accountId: String(t.accountId),
        symbol: t.symbol,
        lots,
      });
      if (res && !res.skipped) credited += 1;
    } catch (err) {
      console.error(
        "[IB_RECONCILE] credit failed",
        tid,
        err?.message || err,
      );
    }
  }

  if (credited > 0) {
    console.log(`[IB_RECONCILE] credited missing commissions for ${credited} trade(s)`);
  }
}

export const startIbCommissionReconcileCron = () => {
  const schedule = process.env.IB_RECONCILE_CRON || "*/5 * * * *";

  const run = async () => {
    try {
      await reconcile();
    } catch (err) {
      console.error("[IB_RECONCILE] cron error:", err?.message || err);
    }
  };

  cron.schedule(schedule, run);
  console.log("[IB_RECONCILE] started:", { schedule });
};
