import ChartDrawing from "../../models/ChartDrawing.model.js";

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .trim()
    .toUpperCase();
}

function normalizeTimeframe(tf) {
  return String(tf || "M5")
    .trim()
    .toUpperCase();
}

function sanitizeDrawings(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((d) => d && typeof d === "object" && typeof d.id === "string" && typeof d.kind === "string")
    .map((d) => ({
      id: String(d.id).slice(0, 80),
      kind: String(d.kind).slice(0, 64),
      symbol: d.symbol ? String(d.symbol).toUpperCase().slice(0, 32) : undefined,
      timeframe: d.timeframe ? String(d.timeframe).toUpperCase().slice(0, 8) : undefined,
      points: Array.isArray(d.points)
        ? d.points
            .filter((p) => p && Number.isFinite(Number(p.time)) && Number.isFinite(Number(p.price)))
            .map((p) => ({ time: Number(p.time), price: Number(p.price) }))
            .slice(0, 64)
        : [],
      path: Array.isArray(d.path)
        ? d.path
            .filter((p) => p && Number.isFinite(Number(p.time)) && Number.isFinite(Number(p.price)))
            .map((p) => ({ time: Number(p.time), price: Number(p.price) }))
            .slice(0, 2000)
        : undefined,
      text: typeof d.text === "string" ? d.text.slice(0, 2000) : undefined,
      style: d.style && typeof d.style === "object" ? d.style : undefined,
      visible: d.visible !== false,
      locked: d.locked === true,
      zIndex: Number.isFinite(Number(d.zIndex)) ? Number(d.zIndex) : 0,
      groupId: typeof d.groupId === "string" ? d.groupId.slice(0, 80) : undefined,
      createdAt: Number(d.createdAt) || Date.now(),
      updatedAt: Number(d.updatedAt) || Date.now(),
      meta: d.meta && typeof d.meta === "object" ? d.meta : undefined,
    }))
    .slice(0, 500);
}

export async function listDrawings({ userId, accountId, symbol, timeframe }) {
  const doc = await ChartDrawing.findOne({
    userId,
    accountId,
    symbol: normalizeSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
  }).lean();
  return {
    drawings: doc?.drawings || [],
    revision: doc?.revision || 0,
    updatedAt: doc?.updatedAt || null,
  };
}

export async function replaceDrawings({ userId, accountId, symbol, timeframe, drawings }) {
  const payload = sanitizeDrawings(drawings);
  const doc = await ChartDrawing.findOneAndUpdate(
    {
      userId,
      accountId,
      symbol: normalizeSymbol(symbol),
      timeframe: normalizeTimeframe(timeframe),
    },
    {
      $set: { drawings: payload },
      $inc: { revision: 1 },
      $setOnInsert: { userId, accountId, symbol: normalizeSymbol(symbol), timeframe: normalizeTimeframe(timeframe) },
    },
    { upsert: true, new: true },
  ).lean();
  return {
    drawings: doc.drawings || [],
    revision: doc.revision || 1,
    updatedAt: doc.updatedAt || null,
  };
}

export async function upsertDrawing({ userId, accountId, symbol, timeframe, drawing }) {
  const [clean] = sanitizeDrawings([drawing]);
  if (!clean) {
    const err = new Error("Invalid drawing");
    err.status = 400;
    throw err;
  }
  const filter = {
    userId,
    accountId,
    symbol: normalizeSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
  };
  let doc = await ChartDrawing.findOne(filter);
  if (!doc) {
    doc = await ChartDrawing.create({ ...filter, drawings: [clean], revision: 1 });
  } else {
    const idx = doc.drawings.findIndex((d) => d && d.id === clean.id);
    if (idx >= 0) doc.drawings[idx] = clean;
    else doc.drawings.push(clean);
    doc.revision = (doc.revision || 0) + 1;
    doc.markModified("drawings");
    await doc.save();
  }
  return { drawing: clean, revision: doc.revision };
}

export async function removeDrawing({ userId, accountId, symbol, timeframe, id }) {
  const filter = {
    userId,
    accountId,
    symbol: normalizeSymbol(symbol),
    timeframe: normalizeTimeframe(timeframe),
  };
  const doc = await ChartDrawing.findOne(filter);
  if (!doc) return { removed: false, revision: 0 };
  const before = doc.drawings.length;
  doc.drawings = doc.drawings.filter((d) => d?.id !== id);
  if (doc.drawings.length === before) return { removed: false, revision: doc.revision || 0 };
  doc.revision = (doc.revision || 0) + 1;
  doc.markModified("drawings");
  await doc.save();
  return { removed: true, revision: doc.revision };
}

export async function clearDrawings({ userId, accountId, symbol, timeframe }) {
  const filter = {
    userId,
    accountId,
    symbol: normalizeSymbol(symbol),
  };
  if (timeframe) filter.timeframe = normalizeTimeframe(timeframe);
  const result = await ChartDrawing.deleteMany(filter);
  return { deletedCount: result.deletedCount || 0 };
}
