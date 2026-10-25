import {
  ALL_BROKER_PERMISSIONS,
  createAdminService,
  createBrokerService,
  grantSuperAdminService,
  inviteBrokerAdminService,
  listAdminsService,
  listBrokersService,
  listMembershipsService,
  updateBrokerService,
  updateMembershipService,
} from "../services/platformBroker.service.js";

export async function listBrokers(req, res) {
  try {
    const data = await listBrokersService();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function createBroker(req, res) {
  try {
    const data = await createBrokerService({
      ...req.body,
      createdBy: req.user._id,
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function updateBroker(req, res) {
  try {
    const data = await updateBrokerService(req.params.brokerId, req.body || {});
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function inviteBrokerAdmin(req, res) {
  try {
    const data = await inviteBrokerAdminService({
      brokerId: req.params.brokerId,
      ...req.body,
      invitedBy: req.user._id,
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function listMemberships(req, res) {
  try {
    const data = await listMembershipsService(req.params.brokerId);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function updateMembership(req, res) {
  try {
    const data = await updateMembershipService(
      req.params.membershipId,
      req.body || {},
    );
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function listPermissions(_req, res) {
  return res.json({ success: true, data: ALL_BROKER_PERMISSIONS });
}

export async function listAdmins(req, res) {
  try {
    const data = await listAdminsService();
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function createAdmin(req, res) {
  try {
    const data = await createAdminService({
      ...req.body,
      invitedBy: req.user._id,
    });
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}

export async function grantSuperAdmin(req, res) {
  try {
    const data = await grantSuperAdminService(req.body?.email);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(400).json({ success: false, message: e.message });
  }
}
