import {
  listPlanSymbolSpreads,
  upsertPlanSymbolSpread,
  seedPlanSymbolSpreadsFromInstruments,
} from "../services/planSymbolSpread.service.js";
import {
  ACTIVITY_ACTIONS,
  logAdminAction,
} from "../services/activity.service.js";

const pssIp = (req) =>
  req.ip || req.headers?.["x-forwarded-for"] || null;

const pssActor = (req) => req.user?._id || req.user?.id || null;

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
    logAdminAction({
      actorId: pssActor(req),
      action: ACTIVITY_ACTIONS.PLAN_SPREAD_UPDATED,
      ip: pssIp(req),
    }).catch(() => {});
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
    logAdminAction({
      actorId: pssActor(req),
      action: ACTIVITY_ACTIONS.PLAN_SPREAD_UPDATED,
      ip: pssIp(req),
    }).catch(() => {});
    return res.json({ success: true, data });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
}
