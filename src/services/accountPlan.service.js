import AccountPlan from '../models/AccountPlan.model.js';
import redis from '../config/redis.js';

/**
 * Redis cache config
 */
const CACHE_KEY = 'account_plans_active';
const CACHE_TTL = 60; // testing ke liye 60 sec

/**
 * Ensure only one default demo plan exists
 */
async function ensureSingleDefaultDemoPlan({ planId, makeDefault }) {
  if (!makeDefault) return;

  // 1) Unset default from others
  await AccountPlan.updateMany(
    { _id: { $ne: planId }, is_default_demo_plan: true },
    { $set: { is_default_demo_plan: false } }
  );

  // 2) Force demo + active
  await AccountPlan.updateOne(
    { _id: planId },
    {
      $set: {
        is_default_demo_plan: true,
        is_demo_allowed: true,
        isActive: true
      }
    }
  );
}

/**
 * Normalize Plan Data (Spread / Commission / Swap Safety)
 */
function normalizePlanData(data) {
  return {
    ...data,

    // ✅ SPREAD PIPS
    spreadPips:
      typeof data.spreadPips === 'number'
        ? data.spreadPips
        : 0,

    // ✅ SPREAD ENABLE / DISABLE
    spread_enabled:
      typeof data.spread_enabled === 'boolean'
        ? data.spread_enabled
        : true,

    // ✅ COMMISSION
    commission_per_lot:
      typeof data.commission_per_lot === 'number'
        ? data.commission_per_lot
        : 0,

    // ✅ SWAP CHARGE
    swap_charge:
      typeof data.swap_charge === 'number'
        ? Math.abs(data.swap_charge)
        : 0,

    // ✅ SWAP ENABLE
    swap_enabled:
      typeof data.swap_enabled === 'boolean'
        ? data.swap_enabled
        : true
  };
}

/* ================= CREATE ================= */

export async function createPlan(data) {
  const normalizedData = normalizePlanData(data);

  const plan = await AccountPlan.create(normalizedData);

  // only one default demo plan
  await ensureSingleDefaultDemoPlan({
    planId: plan._id,
    makeDefault: Boolean(plan.is_default_demo_plan)
  });

  // clear cache
  await redis.del(CACHE_KEY);

  return plan;
}

/* ================= UPDATE ================= */

export async function updatePlan(id, data) {
  const wantsDefaultDemoPlan = data?.is_default_demo_plan === true;

  if (wantsDefaultDemoPlan) {
    await AccountPlan.updateMany(
      { _id: { $ne: id }, is_default_demo_plan: true },
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
            isActive: true
          }
        : {})
    },
    { new: true }
  ).lean();

  if (!plan) {
    const err = new Error('Account plan not found');
    err.statusCode = 404;
    throw err;
  }

  // clear cache
  await redis.del(CACHE_KEY);

  return plan;
}

/* ================= DELETE ================= */

export async function deletePlan(id) {
  const plan = await AccountPlan.findByIdAndDelete(id);

  if (!plan) {
    const err = new Error('Account plan not found');
    err.statusCode = 404;
    throw err;
  }

  await redis.del(CACHE_KEY);
}

/* ================= ADMIN ================= */

export async function getAllPlansAdmin(brokerId = null) {
  const filter = {};
  if (brokerId) filter.brokerId = brokerId;
  return AccountPlan.find(filter).sort({ createdAt: -1 }).lean();
}

/* ================= USER ================= */

export async function getActivePlans() {
  const start = process.hrtime.bigint();

  // Redis GET
  const cached = await redis.get(CACHE_KEY);

  if (cached) {
    const end = process.hrtime.bigint();

    console.log(
      'REDIS HIT |',
      Number(end - start) / 1_000_000,
      'ms'
    );

    return JSON.parse(cached);
  }

  console.log('REDIS MISS');

  // Mongo Query
  const plans = await AccountPlan.find({ isActive: true })
    .sort({ createdAt: -1 })
    .lean();

  // Redis SET
  await redis.set(
    CACHE_KEY,
    JSON.stringify(plans),
    'EX',
    CACHE_TTL
  );

  const end = process.hrtime.bigint();


  return plans;
}
