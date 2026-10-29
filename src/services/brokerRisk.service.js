import Broker from "../models/Broker.model.js";
import BrokerRiskSetting from "../models/BrokerRiskSetting.model.js";

/** In-memory cache for trade engine (sync reads on every tick). */
const cache = new Map();

export const DEFAULT_RISK = Object.freeze({
  warning_loss_percent: 70,
  stop_out_loss_percent: 90,
});

function clampWarning(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_RISK.warning_loss_percent;
  return Math.min(100, Math.max(0, v));
}

function clampStopOut(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return DEFAULT_RISK.stop_out_loss_percent;
  return Math.min(100, Math.max(1, v));
}

async function brokerLabel(brokerId) {
  if (!brokerId) return { brokerCode: null, brokerName: null };
  const broker = await Broker.findById(brokerId)
    .select("code displayName")
    .lean();
  return {
    brokerCode: broker?.code || null,
    brokerName: broker?.displayName || broker?.code || null,
  };
}

async function toPayload(brokerId, doc, defaults) {
  const warning = clampWarning(
    doc?.warning_loss_percent ?? defaults.warning_loss_percent,
  );
  let stopOut = clampStopOut(
    doc?.stop_out_loss_percent ?? defaults.stop_out_loss_percent,
  );
  // Warning must be strictly below stop-out (except both 100).
  if (stopOut < 100 && warning >= stopOut) {
    // keep saved stop-out; clamp warning just under it for response consistency
  }
  const label = await brokerLabel(brokerId);
  return {
    brokerId: brokerId ? String(brokerId) : null,
    brokerCode: label.brokerCode,
    brokerName: label.brokerName,
    warning_loss_percent: warning,
    stop_out_loss_percent: stopOut,
    updatedAt: doc?.updatedAt || null,
  };
}

/** FP (BLACKOS) → 100% exit; Oceana → 90%; else platform default 90%. */
export async function defaultRiskForBroker(brokerId) {
  if (!brokerId) return { ...DEFAULT_RISK };
  const broker = await Broker.findById(brokerId).select("code").lean();
  const code = String(broker?.code || "").toUpperCase();
  if (
    code === "BLACKOS" ||
    code === "FP" ||
    code.includes("FPTRADE") ||
    code.includes("FP_TRADE")
  ) {
    return { warning_loss_percent: 70, stop_out_loss_percent: 100 };
  }
  if (code === "OCEANAPROFX" || code.includes("OCEANA")) {
    return { warning_loss_percent: 70, stop_out_loss_percent: 90 };
  }
  return { ...DEFAULT_RISK };
}

function putCache(brokerId, payload) {
  if (!brokerId) return;
  cache.set(String(brokerId), {
    warning_loss_percent: payload.warning_loss_percent,
    stop_out_loss_percent: payload.stop_out_loss_percent,
  });
}

/** Sync read for RiskManager / engine tick. */
export function getCachedRiskForBroker(brokerId) {
  if (!brokerId) return { ...DEFAULT_RISK };
  return cache.get(String(brokerId)) || { ...DEFAULT_RISK };
}

export async function warmRiskSettingsCache() {
  const rows = await BrokerRiskSetting.find({}).lean();
  cache.clear();
  for (const row of rows) {
    putCache(row.brokerId, {
      warning_loss_percent: clampWarning(row.warning_loss_percent),
      stop_out_loss_percent: clampStopOut(row.stop_out_loss_percent),
    });
  }
  // Also seed cache for brokers without a doc (code-based defaults).
  const brokers = await Broker.find({}).select("_id code").lean();
  for (const b of brokers) {
    const id = String(b._id);
    if (cache.has(id)) continue;
    const d = await defaultRiskForBroker(b._id);
    putCache(id, d);
  }
  return cache.size;
}

export async function getBrokerRiskSettingsService(brokerId) {
  if (!brokerId) throw new Error("brokerId is required");
  const defaults = await defaultRiskForBroker(brokerId);
  const doc = await BrokerRiskSetting.findOne({ brokerId }).lean();
  const payload = await toPayload(brokerId, doc, defaults);
  putCache(brokerId, payload);
  return payload;
}

export async function upsertBrokerRiskSettingsService({
  brokerId,
  warning_loss_percent,
  stop_out_loss_percent,
  updatedBy = null,
}) {
  if (!brokerId) throw new Error("brokerId is required");

  const defaults = await defaultRiskForBroker(brokerId);
  const nextWarning =
    warning_loss_percent !== undefined
      ? clampWarning(warning_loss_percent)
      : undefined;
  const nextStop =
    stop_out_loss_percent !== undefined
      ? clampStopOut(stop_out_loss_percent)
      : undefined;

  if (nextWarning === undefined && nextStop === undefined) {
    throw new Error("At least one setting is required");
  }

  const existing = await BrokerRiskSetting.findOne({ brokerId }).lean();
  const mergedWarning = clampWarning(
    nextWarning ?? existing?.warning_loss_percent ?? defaults.warning_loss_percent,
  );
  const mergedStop = clampStopOut(
    nextStop ?? existing?.stop_out_loss_percent ?? defaults.stop_out_loss_percent,
  );

  if (mergedStop < 100 && mergedWarning >= mergedStop) {
    throw new Error(
      "warning_loss_percent must be lower than stop_out_loss_percent",
    );
  }

  const doc = await BrokerRiskSetting.findOneAndUpdate(
    { brokerId },
    {
      $set: {
        warning_loss_percent: mergedWarning,
        stop_out_loss_percent: mergedStop,
        updatedBy: updatedBy || null,
      },
      $setOnInsert: { brokerId },
    },
    { upsert: true, new: true },
  ).lean();

  const payload = await toPayload(brokerId, doc, defaults);
  putCache(brokerId, payload);
  return payload;
}

/** Ensure DB row exists with broker defaults (first admin open / migration). */
export async function ensureBrokerRiskSettings(brokerId) {
  if (!brokerId) return null;
  const existing = await BrokerRiskSetting.findOne({ brokerId }).lean();
  if (existing) {
    const payload = await toPayload(
      brokerId,
      existing,
      await defaultRiskForBroker(brokerId),
    );
    putCache(brokerId, payload);
    return payload;
  }
  const defaults = await defaultRiskForBroker(brokerId);
  const doc = await BrokerRiskSetting.create({
    brokerId,
    ...defaults,
  });
  const payload = await toPayload(brokerId, doc.toObject(), defaults);
  putCache(brokerId, payload);
  return payload;
}
