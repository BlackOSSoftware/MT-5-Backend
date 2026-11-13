import {
  listPlanSymbolSpreads,
  upsertPlanSymbolSpread,
  seedPlanSymbolSpreadsFromInstruments,
} from "../services/planSymbolSpread.service.js";

export async function listPlanSymbolSpreadsController(req, res) {
  try {
    const data = await listPlanSymbolSpreads(req.params.planId, {
      brokerId: req.brokerId || null,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}

export async function upsertPlanSymbolSpreadController(req, res) {
  try {
    const data = await upsertPlanSymbolSpread(req.params.planId, req.body, {
      brokerId: req.brokerId || null,
    });
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}

export async function seedPlanSymbolSpreadsController(req, res) {
  try {
    const data = await seedPlanSymbolSpreadsFromInstruments(
      req.params.planId,
      { brokerId: req.brokerId || null },
    );
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}
