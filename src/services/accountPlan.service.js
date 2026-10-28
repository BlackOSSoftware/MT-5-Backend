import AccountPlan from "../models/AccountPlan.model.js";
import redis from "../config/redis.js";

/**
 * Redis cache config (per broker)
 */
const CACHE_KEY_PREFIX = "account_plans_active";
const CACHE_TTL = 60;

function cacheKeyForBroker(brokerId) {
  return `${CACHE_KEY_PREFIX}:${brokerId ? String(brokerId) : "none"}`;
}

async function bustPlanCache(brokerId = null) {
  try {
    if (brokerId) {
      await redis.del(cacheKeyForBroker(brokerId));
    }
    // legacy global key from older code
    await redis.del("account_plans_active");
  } catch {
    // ignore cache errors
  }
}

/**
 * Ensure only one default demo plan exists per broker
 */
async function ensureSingleDefaultDemoPlan({ planId, makeDefault, brokerId }) {
  if (!makeDefault) return;

  const unsetFilter = {
    _id: { $ne: planId },
    is_default_demo_plan: true,
  };
  if (brokerId) unsetFilter.brokerId = brokerId;

  await AccountPlan.updateMany(unsetFilter, {
    $set: { is_default_demo_plan: false },
  });

  await AccountPlan.updateOne(
    { _id: planId },
    {
      $set: {
        is_default_demo_plan: true,
        is_demo_allowed: true,
        isActive: true,
      },
    }
  );
}

/**
 * Normalize Plan Data (Spread / Commission / Swap Safety)
 */
function normalizePlanData(data) {
  return {
    ...data,

    spreadPips: typeof data.spreadPips === "number" ? data.spreadPips : 0,
    spread_enabled:
      typeof data.spread_enabled === "boolean" ? data.spread_enabled : true,
    commission_per_lot:
      typeof data.commission_per_lot === "number" ? data.commission_per_lot : 0,
    swap_charge:
      typeof data.swap_charge === "number" ? Math.abs(data.swap_charge) : 0,
    swap_enabled:
      typeof data.swap_enabled === "boolean" ? data.swap_enabled : true,
  };
}

/* ================= CREATE ================= */

export async function createPlan(data) {
  const normalizedData = normalizePlanData(data);

  const plan = await AccountPlan.create(normalizedData);

  await ensureSingleDefaultDemoPlan({
    planId: plan._id,
    makeDefault: Boolean(plan.is_default_demo_plan),
    brokerId: plan.brokerId || null,
  });

  await bustPlanCache(plan.brokerId);
  return plan;
}

/* ================= UPDATE ================= */

export async function updatePlan(id, data, { brokerId = null } = {}) {
  const wantsDefaultDemoPlan = data?.is_default_demo_plan === true;
  const existing = await AccountPlan.findById(id).select("brokerId").lean();
  if (!existing) {
    const err = new Error("Account plan not found");
    err.statusCode = 404;
    throw err;
  }
  if (brokerId && String(existing.brokerId) !== String(brokerId)) {
    const err = new Error("Account plan not found");
    err.statusCode = 404;
    throw err;
  }

  if (wantsDefaultDemoPlan) {
    await AccountPlan.updateMany(
      {
        _id: { $ne: id },
        is_default_demo_plan: true,
        ...(existing.brokerId ? { brokerId: existing.brokerId } : {}),
      },
      { $set: { is_default_demo_plan: false } }
    );
  }

  const normalizedData = normalizePlanData(data);

  const plan = await AccountPlan.findByIdAndUpdate(
    id,
    {
      ...normalizedData,
      ...(wantsDefaultDemoPlan
        ? {
            is_demo_allowed: true,
            isActive: true,
          }
        : {}),
    },
    { new: true }
  ).lean();

  if (!plan) {
    const err = new Error("Account plan not found");
    err.statusCode = 404;
    throw err;
  }

  await bustPlanCache(plan.brokerId);
  return plan;
}

/* ================= DELETE ================= */

export async function deletePlan(id, { brokerId = null } = {}) {
  const filter = { _id: id };
  if (brokerId) filter.brokerId = brokerId;

  const plan = await AccountPlan.findOneAndDelete(filter);

  if (!plan) {
    const err = new Error("Account plan not found");
    err.statusCode = 404;
    throw err;
  }

  await bustPlanCache(plan.brokerId);
}

/* ================= ADMIN ================= */

export async function getAllPlansAdmin(brokerId = null) {
  const filter = {};
  if (brokerId) filter.brokerId = brokerId;
  return AccountPlan.find(filter).sort({ createdAt: -1 }).lean();
}

/* ================= USER ================= */

/**
 * Active plans for one broker only.
 * No brokerId → empty list (never leak other brokers' plans).
 */
export async function getActivePlans(brokerId = null) {
  if (!brokerId) return [];

  const key = cacheKeyForBroker(brokerId);
  const start = process.hrtime.bigint();

  const cached = await redis.get(key);
  if (cached) {
    const end = process.hrtime.bigint();
    console.log("REDIS HIT |", Number(end - start) / 1_000_000, "ms", key);
    return JSON.parse(cached);
  }

  console.log("REDIS MISS", key);

  const plans = await AccountPlan.find({
    isActive: true,
    brokerId,
  })
    .sort({ createdAt: -1 })
    .lean();

  await redis.set(key, JSON.stringify(plans), "EX", CACHE_TTL);
  return plans;
}

/**
 * Default demo plan id for a broker (signup auto-demo).
 */
export async function getDefaultDemoPlanIdForBroker(brokerId) {
  if (!brokerId) return null;
  const plan = await AccountPlan.findOne(
    {
      brokerId,
      isActive: true,
      is_demo_allowed: true,
      is_default_demo_plan: true,
    },
    { _id: 1 }
  ).lean();
  return plan?._id ? String(plan._id) : null;
}
