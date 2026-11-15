import {
  createSubAdminService,
  deleteSubAdminService,
  listSubAdminsService,
  updateSubAdminService,
} from "../services/subAdmin.service.js";
import {
  ACTIVITY_ACTIONS,
  ACTOR_TYPES,
  recordActivity,
} from "../services/activity.service.js";

function logStaffActivity(req, userId, action) {
  if (!userId) return;
  recordActivity({
    userId,
    action,
    actorId: req.user?._id || req.user?.id || null,
    actorType: ACTOR_TYPES.ADMIN,
    ip: req.ip || req.headers?.["x-forwarded-for"] || null,
  }).catch((err) => console.error("ACTIVITY_LOG_ERROR:", err));
}

function shape(m) {
  return {
    _id: m._id,
    status: m.status,
    role: m.role,
    permissions: m.permissions || [],
    createdAt: m.createdAt,
    parentAdminId: m.parentAdminId || null,
    user: m.userId
      ? {
          _id: m.userId._id,
          email: m.userId.email,
          name: m.userId.name,
          createdAt: m.userId.createdAt,
        }
      : null,
  };
}

/** Admin → manage ONLY sub-admins they created (parentAdminId = req.user._id). */

export async function listBrokerStaff(req, res) {
  try {
    const rows = await listSubAdminsService({
      brokerId: req.brokerId,
      parentAdminId: req.user._id,
    });
    return res.json({ success: true, data: rows.map(shape) });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function inviteBrokerStaff(req, res) {
  try {
    const data = await createSubAdminService({
      brokerId: req.brokerId,
      parentAdminId: req.user._id,
      parentPermissions: req.permissions || [],
      email: req.body?.email,
      password: req.body?.password,
      name: req.body?.name,
      permissions: req.body?.permissions,
    });
    logStaffActivity(req, data?.user?._id, ACTIVITY_ACTIONS.ADMIN_CREATED);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function updateBrokerStaff(req, res) {
  try {
    const data = await updateSubAdminService({
      membershipId: req.params.membershipId,
      brokerId: req.brokerId,
      parentAdminId: req.user._id,
      parentPermissions: req.permissions || [],
      patch: req.body || {},
    });
    logStaffActivity(req, data?.userId, ACTIVITY_ACTIONS.ADMIN_UPDATED);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function deleteBrokerStaff(req, res) {
  try {
    const data = await deleteSubAdminService({
      membershipId: req.params.membershipId,
      brokerId: req.brokerId,
      parentAdminId: req.user._id,
    });
    logStaffActivity(req, data?.userId, ACTIVITY_ACTIONS.ADMIN_DELETED);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}
