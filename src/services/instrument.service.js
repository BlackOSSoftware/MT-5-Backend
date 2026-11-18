import redis from '../config/redis.js';
import Instrument from '../models/Instrument.model.js';
import EngineSync from '../trade-engine/EngineSync.js';
import { publishSymbolRemove, publishSymbolUpsert } from '../trade-engine/EngineSyncBus.js';
import {
  invalidateInstrumentProviderCache,
  normalizeProviderCode,
} from './instrumentProvider.service.js';

const LIST_TTL = 300;
const COUNT_TTL = 300;

const VERSION_KEY = 'instruments:version';
const LIST_KEY = 'instruments:list';
const COUNT_KEY = 'instruments:count';
const SPREAD_MODES = new Set(['ADD_ON', 'FIXED']);

const normalizeInstrumentCode = (value) =>
  String(value || '').trim().toUpperCase();

const normalizeInstrumentSegment = (value) =>
  String(value || '').trim().toUpperCase();

const resolveProviderCodeInput = (providerCode, fallbackCode) => {
  const direct = normalizeProviderCode(providerCode);
  if (direct) return direct;
  return normalizeProviderCode(fallbackCode) || null;
};


export const createInstrumentService = async (payload) => {
  const {
    code,
    providerCode,
    name,
    segment,
    lotSize,
    minQty,
    maxQty,
    qtyPrecision,
    pricePrecision,
    tickSize,
    spread,
    spread_mode,
    contractSize,
    swapEnabled,
    swapLong,
    swapShort,
    isActive,
    isTradeable
  } = payload;

  const normalizedCode = normalizeInstrumentCode(code);
  const normalizedProviderCode = resolveProviderCodeInput(providerCode, code);
  const normalizedName = String(name || '').trim();
  const normalizedSegment = normalizeInstrumentSegment(segment);

  /* =========================
     REQUIRED VALIDATION
  ========================== */
  if (!normalizedCode || !normalizedName || !normalizedSegment) {
    throw new Error('code, name and segment are required');
  }

  if (minQty > maxQty) {
    throw new Error('minQty cannot be greater than maxQty');
  }

  if (lotSize <= 0) {
    throw new Error('lotSize must be greater than zero');
  }

  if (spread < 0) {
    throw new Error('spread cannot be negative');
  }

  let normalizedSpreadMode = 'ADD_ON';
  if (spread_mode !== undefined && spread_mode !== null && spread_mode !== '') {
    normalizedSpreadMode = String(spread_mode).trim().toUpperCase();
    if (!SPREAD_MODES.has(normalizedSpreadMode)) {
      throw new Error('Invalid spread_mode. Allowed: ADD_ON, FIXED');
    }
  }

  /* =========================
     DUPLICATE CHECK (FAST)
  ========================== */
  const alreadyExists = await Instrument.exists({
    code: normalizedCode
  });

  if (alreadyExists) {
    throw new Error('Instrument with this code already exists');
  }

  /* =========================
     CREATE INSTRUMENT
  ========================== */
  const instrument = await Instrument.create({
    code: normalizedCode,
    providerCode: normalizedProviderCode,
    name: normalizedName,
    segment: normalizedSegment,
    lotSize,
    minQty,
    maxQty,
    qtyPrecision,
    pricePrecision,
    tickSize,
    spread,
    spread_mode: normalizedSpreadMode,
    contractSize,
    swapEnabled,
    swapLong,
    swapShort,
    isActive,
    isTradeable
  });

  const keys = await redis.keys('instruments:*');
  if (keys.length) await redis.del(keys);

  await redis.incr(VERSION_KEY);
  invalidateInstrumentProviderCache(instrument.code, instrument.providerCode);

  // Sync symbol into trade engine (RAM)
  EngineSync.loadSymbolFromInstrument(instrument);
  publishSymbolUpsert(instrument);

  return instrument;
};


export async function getAllInstrumentService(page, limit, segment) {
  const skip = (page - 1) * limit;

  const seg = (segment || 'ALL').toUpperCase();
  const isAll = seg === 'ALL';

  const filter = isAll ? {} : { segment: seg };

  // Get cache version
  const version = (await redis.get(VERSION_KEY)) || 1;

  // Versioned keys
  const listKey = `${LIST_KEY}:v${version}:${seg}:p=${page}:l=${limit}`;
  const countKey = `${COUNT_KEY}:v${version}:${seg}`;

  // Redis GET
  const [cachedList, cachedCount] = await redis.mget(
    listKey,
    countKey
  );

  if (cachedList && cachedCount) {
    return {
      data: JSON.parse(cachedList),
      total: Number(cachedCount)
    };
  }

  // DB queries
  const [data, total] = await Promise.all([
    cachedList
      ? JSON.parse(cachedList)
      : Instrument.find(filter)
          .sort({ code: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),

    cachedCount
      ? Number(cachedCount)
      : isAll
        ? Instrument.estimatedDocumentCount()
        : Instrument.countDocuments(filter)
  ]);

  // Cache set
  await redis.multi()
    .set(listKey, JSON.stringify(data), 'EX', LIST_TTL)
    .set(countKey, total, 'EX', COUNT_TTL)
    .exec();

  return { data, total };
}

export async function searchInstrumentService(qRaw, segmentRaw, limitRaw) {
  const q = String(qRaw || "").trim();
  const segment = String(segmentRaw || "").trim().toUpperCase();
  const limit = Math.min(Math.max(Number(limitRaw || 20), 1), 200);

  if (!q) {
    throw new Error("Search query (q) is required");
  }

  if (q.length > 50) {
    throw new Error("Search query is too long");
  }

  const filter = {
    $or: [
      { code: { $regex: q, $options: "i" } },
      { name: { $regex: q, $options: "i" } }
    ]
  };

  if (segment && segment !== "ALL") {
    filter.segment = segment;
  }

  const instruments = await Instrument.find(filter)
    .sort({ code: 1 })
    .limit(limit)
    .select("-_id")
    .lean();

  return instruments || [];
}


export const updateInstrumentService = async (id, payload) => {
  const existing = await Instrument.findById(id);

  if (!existing) {
    throw new Error('Instrument not found');
  }

  /* =========================
     DUPLICATE CODE CHECK
  ========================== */
  let nextCode = existing.code;
  if (payload.code !== undefined) {
    nextCode = normalizeInstrumentCode(payload.code);
    if (!nextCode) {
      throw new Error('code is required');
    }
  }

  let nextSegment = existing.segment;
  if (payload.segment !== undefined) {
    nextSegment = normalizeInstrumentSegment(payload.segment);
    if (!nextSegment) {
      throw new Error('segment is required');
    }
  }

  const currentProviderCode = resolveProviderCodeInput(
    existing.providerCode,
    existing.code
  );

  let nextProviderCode = currentProviderCode;
  if (payload.providerCode !== undefined) {
    nextProviderCode = resolveProviderCodeInput(payload.providerCode, payload.code);
  } else if (
    payload.code !== undefined &&
    (!existing.providerCode || currentProviderCode === existing.code)
  ) {
    nextProviderCode = resolveProviderCodeInput(payload.code, payload.code);
  }

  if (nextCode !== existing.code) {
    const alreadyExists = await Instrument.exists({
      code: nextCode,
      _id: { $ne: id }
    });

    if (alreadyExists) {
      throw new Error('Instrument with this code already exists');
    }
  }

  /* =========================
     SPREAD VALIDATION
  ========================== */
  if (payload.spread !== undefined && payload.spread < 0) {
    throw new Error('spread cannot be negative');
  }

  if (
    payload.spread_mode !== undefined &&
    payload.spread_mode !== null &&
    payload.spread_mode !== ''
  ) {
    const nextMode = String(payload.spread_mode).trim().toUpperCase();
    if (!SPREAD_MODES.has(nextMode)) {
      throw new Error('Invalid spread_mode. Allowed: ADD_ON, FIXED');
    }
    payload.spread_mode = nextMode;
  }

  /* =========================
     UPDATE
  ========================== */
  const updated = await Instrument.findByIdAndUpdate(
    id,
    {
      $set: {
        ...payload,

        code: nextCode,
        providerCode: nextProviderCode,

        segment: nextSegment
      }
    },
    { new: true, runValidators: true }
  ).lean();

  // Cache invalidate
  await redis.incr(VERSION_KEY);
  invalidateInstrumentProviderCache(
    existing.code,
    existing.providerCode,
    nextCode,
    nextProviderCode
  );

  // Property page / order UI cache must pick up new minQty/maxQty immediately.
  try {
    const { invalidatePropertyCache } = await import("./property.service.js");
    await invalidatePropertyCache();
  } catch {
    // non-fatal
  }

  // Sync symbol into trade engine (RAM)
  EngineSync.loadSymbolFromInstrument(updated);
  publishSymbolUpsert(updated);

  return updated;
};


export const deleteInstrumentService = async (id) => {
  if (!id || id.length !== 24) {
    throw new Error('Invalid instrument id');
  }

  const instrument = await Instrument.findById(id);

  if (!instrument) {
    throw new Error('Instrument not found');
  }

  /* =========================
     DELETE
  ========================== */
  await Instrument.deleteOne({ _id: id });

  // Cache invalidate
  await redis.incr(VERSION_KEY);
  invalidateInstrumentProviderCache(instrument.code, instrument.providerCode);

  // Remove symbol from trade engine (RAM)
  EngineSync.removeInstrumentByCode(instrument.code);
  publishSymbolRemove(instrument.code);

  return instrument;
};
