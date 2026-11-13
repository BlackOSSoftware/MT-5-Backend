import SlippageSetting from "../models/SlippageSetting.model.js";
import User from "../models/User.model.js";
import { publishSlippageSettings } from "../trade-engine/EngineSyncBus.js";

const SETTINGS_KEY = "GLOBAL";
const CACHE_TTL_MS = 30 * 1000;

let cachedSettings = null;
let cachedAt = 0;

function clampPoints(value, fieldName) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${fieldName} must be a number >= 0`);
  }
  return n;
}

function normalizeMode(value) {
  const mode = String(value || "FIXED").trim().toUpperCase();
  if (mode !== "FIXED" && mode !== "RANDOM") {
    throw new Error("mode must be FIXED or RANDOM");
  }
  return mode;
}

async function getOrCreateSettings() {
  let settings = await SlippageSetting.findOne({ key: SETTINGS_KEY });
  if (!settings) {
    settings = await SlippageSetting.create({
      key: SETTINGS_KEY,
      enabled: false,
      mode: "FIXED",
      fixed_points: 0,
      min_points: 0,
      max_points: 0,
      apply_market_orders: true,
      apply_stop_orders: true,
      apply_close: false,
      direction: "ADVERSE_ONLY",
    });
  }
  return settings;
}

async function toPayload(settings) {
  let updatedByInfo = null;
  if (settings?.updatedBy) {
    const admin = await User.findById(settings.updatedBy)
      .select("name email")
      .lean();
    if (admin) {
      updatedByInfo = {
        id: String(admin._id),
        name: admin.name || null,
        email: admin.email || null,
      };
    }
  }

  return {
    enabled: Boolean(settings.enabled),
    mode: settings.mode === "RANDOM" ? "RANDOM" : "FIXED",
    fixed_points: Number(settings.fixed_points || 0),
    min_points: Number(settings.min_points || 0),
    max_points: Number(settings.max_points || 0),
    apply_market_orders: settings.apply_market_orders !== false,
    apply_stop_orders: settings.apply_stop_orders !== false,
    apply_close: settings.apply_close === true,
    direction: "ADVERSE_ONLY",
    updatedBy: updatedByInfo,
    updatedAt: settings.updatedAt || null,
    createdAt: settings.createdAt || null,
  };
}

export async function getSlippageSettingsCached({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedSettings && now - cachedAt < CACHE_TTL_MS) {
    return cachedSettings;
  }
  const settings = await getOrCreateSettings();
  cachedSettings = settings.toObject ? settings.toObject() : settings;
  cachedAt = now;
  return cachedSettings;
}

export async function getSlippageSettingsService() {
  const settings = await getSlippageSettingsCached({ force: true });
  return toPayload(settings);
}

export async function upsertSlippageSettingsService(payload = {}, { updatedBy } = {}) {
  const setPayload = {};

  if (payload.enabled !== undefined) {
    setPayload.enabled = Boolean(payload.enabled);
  }
  if (payload.mode !== undefined) {
    setPayload.mode = normalizeMode(payload.mode);
  }
  if (payload.fixed_points !== undefined) {
    setPayload.fixed_points = clampPoints(payload.fixed_points, "fixed_points");
  }
  if (payload.min_points !== undefined) {
    setPayload.min_points = clampPoints(payload.min_points, "min_points");
  }
  if (payload.max_points !== undefined) {
    setPayload.max_points = clampPoints(payload.max_points, "max_points");
  }
  if (payload.apply_market_orders !== undefined) {
    setPayload.apply_market_orders = Boolean(payload.apply_market_orders);
  }
  if (payload.apply_stop_orders !== undefined) {
    setPayload.apply_stop_orders = Boolean(payload.apply_stop_orders);
  }
  if (payload.apply_close !== undefined) {
    setPayload.apply_close = Boolean(payload.apply_close);
  }
  if (payload.direction !== undefined) {
    const dir = String(payload.direction).trim().toUpperCase();
    if (dir !== "ADVERSE_ONLY") {
      throw new Error("direction must be ADVERSE_ONLY");
    }
    setPayload.direction = dir;
  }

  if (!Object.keys(setPayload).length) {
    throw new Error("At least one setting is required");
  }

  // Merge with existing values so partial updates still validate min <= max.
  const existing = await getSlippageSettingsCached({ force: true });
  const merged = {
    mode: setPayload.mode ?? existing.mode ?? "FIXED",
    fixed_points:
      setPayload.fixed_points ?? Number(existing.fixed_points || 0),
    min_points: setPayload.min_points ?? Number(existing.min_points || 0),
    max_points: setPayload.max_points ?? Number(existing.max_points || 0),
  };

  if (merged.mode === "RANDOM" && merged.max_points < merged.min_points) {
    throw new Error("max_points cannot be less than min_points");
  }
  if (merged.mode === "FIXED" && merged.fixed_points < 0) {
    throw new Error("fixed_points must be >= 0");
  }

  setPayload.updatedBy = updatedBy || null;

  const setOnInsert = { key: SETTINGS_KEY };
  if (setPayload.enabled === undefined) setOnInsert.enabled = false;
  if (setPayload.mode === undefined) setOnInsert.mode = "FIXED";
  if (setPayload.fixed_points === undefined) setOnInsert.fixed_points = 0;
  if (setPayload.min_points === undefined) setOnInsert.min_points = 0;
  if (setPayload.max_points === undefined) setOnInsert.max_points = 0;
  if (setPayload.apply_market_orders === undefined) {
    setOnInsert.apply_market_orders = true;
  }
  if (setPayload.apply_stop_orders === undefined) {
    setOnInsert.apply_stop_orders = true;
  }
  if (setPayload.apply_close === undefined) setOnInsert.apply_close = false;
  if (setPayload.direction === undefined) {
    setPayload.direction = "ADVERSE_ONLY";
  }

  const settings = await SlippageSetting.findOneAndUpdate(
    { key: SETTINGS_KEY },
    {
      $set: setPayload,
      $setOnInsert: setOnInsert,
    },
    { upsert: true, new: true },
  );

  cachedSettings = settings.toObject ? settings.toObject() : settings;
  cachedAt = Date.now();

  const result = await toPayload(cachedSettings);

  try {
    publishSlippageSettings({
      enabled: result.enabled,
      mode: result.mode,
      fixed_points: result.fixed_points,
      min_points: result.min_points,
      max_points: result.max_points,
      apply_market_orders: result.apply_market_orders,
      apply_stop_orders: result.apply_stop_orders,
      apply_close: result.apply_close,
      direction: result.direction,
    });
  } catch (err) {
    console.warn("[SLIPPAGE] publishSlippageSettings failed:", err?.message || err);
  }

  return result;
}
