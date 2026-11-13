import mongoose from "mongoose";
import PlanSymbolSpread from "../models/PlanSymbolSpread.model.js";
import AccountPlan from "../models/AccountPlan.model.js";
import Instrument from "../models/Instrument.model.js";
import {
  computeClientSpreadWidth,
  computePipView,
} from "./spreadResolver.service.js";

function assertObjectId(id, label = "id") {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error(`Invalid ${label}`);
    err.statusCode = 400;
    throw err;
  }
}

async function assertPlanAccess(planId, brokerId = null) {
  assertObjectId(planId, "planId");
  const plan = await AccountPlan.findById(planId).lean();
  if (!plan) {
    const err = new Error("Account plan not found");
    err.statusCode = 404;
    throw err;
  }
  if (brokerId && String(plan.brokerId || "") !== String(brokerId)) {
    const err = new Error("Account plan not found");
    err.statusCode = 404;
    throw err;
  }
  return plan;
}

function enrichRow(row, instrumentByCode) {
  const code = String(row.symbol || "").toUpperCase();
  const inst = instrumentByCode.get(code) || null;
  const contractSize = Number(inst?.contractSize) > 0 ? Number(inst.contractSize) : 1;
  const tickSize = Number(inst?.tickSize) > 0 ? Number(inst.tickSize) : null;
  const pipSize = tickSize; // no pipSize field yet — use tickSize when present
  const clientSpread = computeClientSpreadWidth({
    houseUsdPerLot: row.house_usd_per_lot,
    ibUsdPerLot: row.ib_usd_per_lot,
    contractSize,
    override: row.client_spread_override,
  });
  const totalUsd =
    (Number(row.house_usd_per_lot) || 0) + (Number(row.ib_usd_per_lot) || 0);

  return {
    ...row,
    total_usd_per_lot: totalUsd,
    client_spread: clientSpread,
    contractSize,
    pipSize,
    pip_view: computePipView(clientSpread, pipSize),
    half_spread: clientSpread / 2,
    instrument_name: inst?.name || null,
    instrument_default_spread: inst?.spread ?? null,
  };
}

export async function listPlanSymbolSpreads(planId, { brokerId = null } = {}) {
  await assertPlanAccess(planId, brokerId);

  const [rows, instruments] = await Promise.all([
    PlanSymbolSpread.find({ planId }).sort({ symbol: 1 }).lean(),
    Instrument.find({ isActive: true })
      .select("code name contractSize tickSize spread spread_mode")
      .lean(),
  ]);

  const byCode = new Map(
    instruments.map((i) => [String(i.code).toUpperCase(), i]),
  );

  // Merge: show all active instruments; attach saved row when present
  const saved = new Map(rows.map((r) => [String(r.symbol).toUpperCase(), r]));
  const merged = [];

  for (const inst of instruments) {
    const code = String(inst.code).toUpperCase();
    const existing = saved.get(code);
    if (existing) {
      merged.push(enrichRow(existing, byCode));
      saved.delete(code);
    } else {
      merged.push(
        enrichRow(
          {
            _id: null,
            planId,
            symbol: code,
            house_usd_per_lot: 0,
            ib_usd_per_lot: 0,
            client_spread_override: null,
            isActive: false,
            brokerId: null,
          },
          byCode,
        ),
      );
    }
  }

  // leftover rows for inactive/removed symbols
  for (const leftover of saved.values()) {
    merged.push(enrichRow(leftover, byCode));
  }

  return merged;
}

export async function upsertPlanSymbolSpread(
  planId,
  payload,
  { brokerId = null } = {},
) {
  const plan = await assertPlanAccess(planId, brokerId);
  const symbol = String(payload.symbol || "")
    .trim()
    .toUpperCase();
  if (!symbol) {
    const err = new Error("symbol is required");
    err.statusCode = 400;
    throw err;
  }

  const house = Number(payload.house_usd_per_lot);
  const ib = Number(payload.ib_usd_per_lot);
  if (!Number.isFinite(house) || house < 0) {
    const err = new Error("Invalid Company $ / lot");
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(ib) || ib < 0) {
    const err = new Error("Invalid IB $ / lot");
    err.statusCode = 400;
    throw err;
  }

  let override = payload.client_spread_override;
  if (override === "" || override === undefined) override = null;
  if (override !== null) {
    override = Number(override);
    if (!Number.isFinite(override) || override < 0) {
      const err = new Error("Invalid client_spread_override");
      err.statusCode = 400;
      throw err;
    }
  }

  const isActive =
    typeof payload.isActive === "boolean" ? payload.isActive : true;

  const doc = await PlanSymbolSpread.findOneAndUpdate(
    { planId, symbol },
    {
      $set: {
        brokerId: plan.brokerId || brokerId || null,
        planId,
        symbol,
        house_usd_per_lot: house,
        ib_usd_per_lot: ib,
        client_spread_override: override,
        isActive,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  const inst = await Instrument.findOne({ code: symbol })
    .select("code name contractSize tickSize spread")
    .lean();
  const byCode = new Map(
    inst ? [[String(inst.code).toUpperCase(), inst]] : [],
  );
  const enriched = enrichRow(doc, byCode);

  // Keep engine memory cache in sync (no-op when feature flag off)
  try {
    const { setCachedPlanSpread } = await import("./planSpreadMemoryCache.js");
    setCachedPlanSpread(planId, symbol, {
      clientSpread: enriched.client_spread,
      houseUsdPerLot: enriched.house_usd_per_lot,
      ibUsdPerLot: enriched.ib_usd_per_lot,
      isActive: enriched.isActive,
    });
  } catch {
    // ignore cache sync errors
  }

  return enriched;
}

export async function seedPlanSymbolSpreadsFromInstruments(
  planId,
  { brokerId = null, onlyMissing = true } = {},
) {
  const plan = await assertPlanAccess(planId, brokerId);
  const instruments = await Instrument.find({ isActive: true })
    .select("code")
    .lean();

  let created = 0;
  for (const inst of instruments) {
    const symbol = String(inst.code).toUpperCase();
    const existing = await PlanSymbolSpread.findOne({ planId, symbol })
      .select("_id")
      .lean();
    if (existing && onlyMissing) continue;

    if (!existing) {
      await PlanSymbolSpread.create({
        brokerId: plan.brokerId || brokerId || null,
        planId,
        symbol,
        house_usd_per_lot: 0,
        ib_usd_per_lot: 0,
        isActive: false,
      });
      created += 1;
    }
  }
  return { created, totalInstruments: instruments.length };
}

/** Hook after plan create — non-blocking seed */
export async function seedPlanSymbolSpreadsSafe(planId, brokerId = null) {
  try {
    return await seedPlanSymbolSpreadsFromInstruments(planId, {
      brokerId,
      onlyMissing: true,
    });
  } catch (err) {
    console.warn(
      "[PlanSymbolSpread] seed failed:",
      err?.message || err,
    );
    return null;
  }
}
