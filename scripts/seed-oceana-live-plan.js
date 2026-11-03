/**
 * Seed Oceana live (+ ensure demo) account plans for broker 6addfa64c27bf05cb0606932.
 * Usage: node scripts/seed-oceana-live-plan.js
 */
import "dotenv/config";
import mongoose from "mongoose";

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI missing");
  process.exit(1);
}

const brokerId = new mongoose.Types.ObjectId("6addfa64c27bf05cb0606932");

await mongoose.connect(uri);
const db = mongoose.connection.db;
const col = db.collection("accountplans");

const existing = await col
  .find({ brokerId, isActive: true })
  .project({ name: 1, is_demo_allowed: 1, minDeposit: 1, max_leverage: 1 })
  .toArray();

console.log(
  "EXISTING_PLANS",
  existing.map((p) => ({
    id: String(p._id),
    name: p.name,
    demo: p.is_demo_allowed === true,
    minDeposit: p.minDeposit,
    leverage: p.max_leverage,
  })),
);

async function upsertPlan(doc) {
  const found = await col.findOne({
    brokerId,
    name: doc.name,
  });
  if (found) {
    await col.updateOne(
      { _id: found._id },
      {
        $set: {
          ...doc,
          brokerId,
          updatedAt: new Date(),
        },
      },
    );
    console.log("UPDATED", doc.name, String(found._id));
    return found._id;
  }
  const ins = await col.insertOne({
    ...doc,
    brokerId,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  console.log("CREATED", doc.name, String(ins.insertedId));
  return ins.insertedId;
}

await upsertPlan({
  name: "Oceana Standard",
  spreadPips: 1.4,
  spread_enabled: true,
  commission: 0,
  commission_per_lot: 0,
  leverageNote: "1:500",
  max_leverage: 500,
  minLotSize: 0.01,
  minDeposit: 100,
  guidance: "+300 Instruments. Forex, Metals, Indices…",
  is_demo_allowed: false,
  swap_enabled: true,
  swap_charge: 0,
  referral_reward_amount: 0,
  isActive: true,
  is_default_demo_plan: false,
});

await upsertPlan({
  name: "Oceana Raw",
  spreadPips: 0.2,
  spread_enabled: true,
  commission: 0,
  commission_per_lot: 3,
  leverageNote: "1:500",
  max_leverage: 500,
  minLotSize: 0.01,
  minDeposit: 500,
  guidance: "+300 Instruments. Forex, Metals, Indices…",
  is_demo_allowed: false,
  swap_enabled: true,
  swap_charge: 0,
  referral_reward_amount: 0,
  isActive: true,
  is_default_demo_plan: false,
});

await upsertPlan({
  name: "Oceana Demo",
  spreadPips: 1.4,
  spread_enabled: true,
  commission: 0,
  commission_per_lot: 0,
  leverageNote: "1:500",
  max_leverage: 500,
  minLotSize: 0.01,
  minDeposit: 0,
  guidance: "+300 Instruments. Forex, Metals, Indices…",
  is_demo_allowed: true,
  swap_enabled: true,
  swap_charge: 0,
  referral_reward_amount: 0,
  isActive: true,
  is_default_demo_plan: true,
});

// Bust redis-style cache keys if redis collection isn't used — API uses redis.
// Print final list for verification.
const final = await col
  .find({ brokerId, isActive: true })
  .project({ name: 1, is_demo_allowed: 1, minDeposit: 1, max_leverage: 1, spreadPips: 1 })
  .toArray();
console.log(
  "FINAL_PLANS",
  final.map((p) => ({
    id: String(p._id),
    name: p.name,
    demo: p.is_demo_allowed === true,
    minDeposit: p.minDeposit,
    spread: p.spreadPips,
    leverage: p.max_leverage,
  })),
);

await mongoose.disconnect();
console.log("DONE");
