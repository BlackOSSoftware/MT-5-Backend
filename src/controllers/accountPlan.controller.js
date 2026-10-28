import {
  createPlan,
  updatePlan,
  deletePlan,
  getAllPlansAdmin,
  getActivePlans,
} from "../services/accountPlan.service.js";

/* ================= ADMIN ================= */

export const createAccountPlan = async (req, res) => {
  try {
    const plan = await createPlan({
      ...req.body,
      ...(req.brokerId ? { brokerId: req.brokerId } : {}),
    });
    return res.json({ success: true, data: plan });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};

export const updateAccountPlan = async (req, res) => {
  try {
    const plan = await updatePlan(req.params.id, req.body, {
      brokerId: req.brokerId || null,
    });
    return res.json({ success: true, data: plan });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
};

export const deleteAccountPlan = async (req, res) => {
  try {
    await deletePlan(req.params.id, { brokerId: req.brokerId || null });
    return res.json({ success: true });
  } catch (err) {
    return res
      .status(err.statusCode || 400)
      .json({ success: false, message: err.message });
  }
};

export const getPlansAdmin = async (req, res) => {
  const plans = await getAllPlansAdmin(req.brokerId || null);
  return res.json({ success: true, data: plans });
};

/* ================= USER ================= */

export const getPlansForUser = async (req, res) => {
  try {
    const brokerId = req.user?.brokerId || null;
    const plans = await getActivePlans(brokerId);
    return res.json({ success: true, data: plans });
  } catch (err) {
    return res.status(400).json({ success: false, message: err.message });
  }
};
