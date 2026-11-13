import IbLevelSettings from "../models/IbLevelSettings.model.js";

const DEFAULT_LEVELS = [
  { level: 1, percent: 70 },
  { level: 2, percent: 30 },
];

function normalizeLevels(levels) {
  if (!Array.isArray(levels) || levels.length === 0) {
    return DEFAULT_LEVELS.map((l) => ({ ...l }));
  }

  const cleaned = levels
    .map((l) => ({
      level: Number(l.level),
      percent: Number(l.percent),
    }))
    .filter(
      (l) =>
        Number.isFinite(l.level) &&
        l.level >= 1 &&
        Number.isFinite(l.percent) &&
        l.percent >= 0 &&
        l.percent <= 100,
    )
    .sort((a, b) => a.level - b.level);

  if (!cleaned.length) {
    const err = new Error("At least one valid level is required");
    err.statusCode = 400;
    throw err;
  }

  const sum = cleaned.reduce((s, l) => s + l.percent, 0);
  if (sum > 100 + 1e-9) {
    const err = new Error(
      `Level percents sum to ${sum.toFixed(2)} — must be <= 100`,
    );
    err.statusCode = 400;
    throw err;
  }

  // unique levels
  const seen = new Set();
  for (const l of cleaned) {
    if (seen.has(l.level)) {
      const err = new Error(`Duplicate level ${l.level}`);
      err.statusCode = 400;
      throw err;
    }
    seen.add(l.level);
  }

  return cleaned;
}

export async function getIbLevelSettings(brokerId = null) {
  const query = brokerId
    ? { brokerId }
    : { $or: [{ brokerId: null }, { brokerId: { $exists: false } }] };

  let doc = await IbLevelSettings.findOne(query).lean();
  if (!doc && brokerId) {
    // fallback to global null settings
    doc = await IbLevelSettings.findOne({ brokerId: null }).lean();
  }

  if (!doc) {
    return {
      brokerId: brokerId || null,
      levels: DEFAULT_LEVELS.map((l) => ({ ...l })),
      maxDepth: 2,
      isDefault: true,
    };
  }

  return { ...doc, isDefault: false };
}

export async function upsertIbLevelSettings(
  payload,
  { brokerId = null } = {},
) {
  const levels = normalizeLevels(payload.levels);
  let maxDepth = Number(payload.maxDepth);
  if (!Number.isFinite(maxDepth) || maxDepth < 1) {
    maxDepth = Math.max(...levels.map((l) => l.level));
  }
  maxDepth = Math.min(10, Math.max(1, maxDepth));

  const filter = brokerId ? { brokerId } : { brokerId: null };
  const doc = await IbLevelSettings.findOneAndUpdate(
    filter,
    {
      $set: {
        brokerId: brokerId || null,
        levels,
        maxDepth,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return doc;
}
