import mongoose from "mongoose";
import bcrypt from "bcrypt";
import BrokerMembership from "../models/BrokerMembership.model.js";
import User from "../models/User.model.js";
import Auth from "../models/Auth.model.js";
import {
  ALL_BROKER_PERMISSIONS,
  BROKER_PERMISSIONS,
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUS,
} from "../constants/brokerPermissions.js";

const rounds = () => Number(process.env.BCRYPT_ROUNDS || 10);

/**
 * Permission ceiling for whoever is creating/editing a sub-admin.
 * SuperAdmin → everything. Admin → only what they themselves have
 * ("*" legacy admins → everything).
 */
export function permissionCeiling({ isSuperAdmin, permissions }) {
  if (isSuperAdmin) return [...ALL_BROKER_PERMISSIONS];
  const mine = permissions || [];
  if (mine.includes("*")) return [...ALL_BROKER_PERMISSIONS];
  return BROKER_PERMISSIONS.filter((p) => mine.includes(p));
}

/** Validate requested perms against ceiling; returns cleaned array. */
export function clampPermissions(requested, ceiling) {
  const req = Array.isArray(requested) ? requested : [];
  const cleaned = req.filter((p) => ceiling.includes(p));
  // Empty selection = no access (explicit, not full access).
  return [...new Set(cleaned)];
}

/**
 * Admin creates a Sub-Admin under their own account.
 * parentAdminId is ALWAYS the authenticated admin — never trusted from client.
 */
export async function createSubAdminService({
  brokerId,
  parentAdminId,
  parentPermissions,
  email,
  password,
  name,
  permissions,
}) {
  if (!mongoose.isValidObjectId(brokerId)) throw new Error("Invalid brokerId");
  if (!mongoose.isValidObjectId(parentAdminId)) {
    throw new Error("Invalid parentAdminId");
  }

  const mail = String(email || "")
    .trim()
    .toLowerCase();
  if (!mail) throw new Error("Email required");

  const ceiling = permissionCeiling({
    isSuperAdmin: false,
    permissions: parentPermissions,
  });
  const perms = clampPermissions(permissions, ceiling);

  let user = await User.findOne({ email: mail });
  let tempPassword = null;

  if (!user) {
    const pass =
      String(password || "").trim() ||
      `SubAdmin@${Date.now().toString().slice(-6)}`;
    tempPassword = pass;
    user = await User.create({
      email: mail,
      name: String(name || mail.split("@")[0]).trim(),
      userType: "ADMIN",
      isMailVerified: true,
      brokerId,
      platformRole: null,
    });
    const hash = await bcrypt.hash(pass, rounds());
    await Auth.create({ user_id: user._id, password_hash: hash });
  } else {
    if (user.userType !== "ADMIN") {
      throw new Error("Email belongs to a non-admin account");
    }
    if (!user.brokerId) {
      user.brokerId = brokerId;
      await user.save();
    }
    if (String(user.brokerId) !== String(brokerId)) {
      throw new Error("User already belongs to another broker");
    }
    if (password) {
      const hash = await bcrypt.hash(String(password).trim(), rounds());
      await Auth.updateOne(
        { user_id: user._id },
        { $set: { password_hash: hash } },
        { upsert: true },
      );
      tempPassword = String(password).trim();
    }
  }

  const membership = await BrokerMembership.findOneAndUpdate(
    { brokerId, userId: user._id },
    {
      $set: {
        role: MEMBERSHIP_ROLES.SUB_ADMIN,
        permissions: perms,
        status: MEMBERSHIP_STATUS.ACTIVE,
        invitedBy: parentAdminId,
        parentAdminId,
        acceptedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  ).lean();

  return {
    user: {
      _id: user._id,
      email: user.email,
      name: user.name,
      userType: user.userType,
    },
    membership,
    temporaryPassword: tempPassword,
  };
}

/** List sub-admins created by a specific admin (same broker). */
export async function listSubAdminsService({ brokerId, parentAdminId }) {
  return BrokerMembership.find({
    brokerId,
    parentAdminId,
    role: MEMBERSHIP_ROLES.SUB_ADMIN,
    status: { $ne: MEMBERSHIP_STATUS.DELETED },
  })
    .populate("userId", "email name userType createdAt")
    .sort({ createdAt: -1 })
    .lean();
}

/** Fetch a membership only if it belongs to this admin. */
async function ownedMembership({ membershipId, brokerId, parentAdminId }) {
  if (!mongoose.isValidObjectId(membershipId)) {
    throw new Error("Invalid membershipId");
  }
  const m = await BrokerMembership.findById(membershipId).lean();
  if (
    !m ||
    String(m.brokerId) !== String(brokerId) ||
    String(m.parentAdminId) !== String(parentAdminId) ||
    m.role !== MEMBERSHIP_ROLES.SUB_ADMIN ||
    m.status === MEMBERSHIP_STATUS.DELETED
  ) {
    throw new Error("Sub-admin not found");
  }
  return m;
}

export async function updateSubAdminService({
  membershipId,
  brokerId,
  parentAdminId,
  parentPermissions,
  patch,
}) {
  await ownedMembership({ membershipId, brokerId, parentAdminId });

  const $set = {};
  if (patch.status && Object.values(MEMBERSHIP_STATUS).includes(patch.status)) {
    if (patch.status === MEMBERSHIP_STATUS.DELETED) {
      throw new Error("Use delete endpoint to remove a sub-admin");
    }
    $set.status = patch.status;
  }
  if (Array.isArray(patch.permissions)) {
    const ceiling = permissionCeiling({
      isSuperAdmin: false,
      permissions: parentPermissions,
    });
    $set.permissions = clampPermissions(patch.permissions, ceiling);
  }

  const updated = await BrokerMembership.findByIdAndUpdate(
    membershipId,
    { $set },
    { new: true },
  ).lean();
  if (!updated) throw new Error("Sub-admin not found");
  return updated;
}

export async function deleteSubAdminService({
  membershipId,
  brokerId,
  parentAdminId,
}) {
  await ownedMembership({ membershipId, brokerId, parentAdminId });
  const updated = await BrokerMembership.findByIdAndUpdate(
    membershipId,
    { $set: { status: MEMBERSHIP_STATUS.DELETED } },
    { new: true },
  ).lean();
  return updated;
}

/**
 * SuperAdmin hierarchy: Admins (BROKER_ADMIN) with their Sub-Admins.
 * Returns tree + flat stats.
 */
export async function adminHierarchyService() {
  const memberships = await BrokerMembership.find({
    status: { $ne: MEMBERSHIP_STATUS.DELETED },
  })
    .populate("userId", "email name userType platformRole createdAt")
    .populate("brokerId", "code displayName status")
    .populate("parentAdminId", "email name")
    .sort({ createdAt: 1 })
    .lean();

  const admins = [];
  const subsByParent = new Map();

  for (const m of memberships) {
    if (!m.userId) continue;
    const node = {
      membershipId: m._id,
      role: m.role,
      status: m.status,
      permissions: m.permissions || [],
      createdAt: m.createdAt,
      broker: m.brokerId
        ? { _id: m.brokerId._id, code: m.brokerId.code, displayName: m.brokerId.displayName }
        : null,
      user: {
        _id: m.userId._id,
        email: m.userId.email,
        name: m.userId.name,
        createdAt: m.userId.createdAt,
      },
      parentAdmin: m.parentAdminId
        ? { _id: m.parentAdminId._id, email: m.parentAdminId.email, name: m.parentAdminId.name }
        : null,
      subAdmins: [],
    };

    if (m.role === MEMBERSHIP_ROLES.SUB_ADMIN && m.parentAdminId) {
      const key = String(m.parentAdminId);
      if (!subsByParent.has(key)) subsByParent.set(key, []);
      subsByParent.get(key).push(node);
    } else {
      admins.push(node);
    }
  }

  for (const admin of admins) {
    admin.subAdmins = subsByParent.get(String(admin.user._id)) || [];
  }

  return { admins };
}
