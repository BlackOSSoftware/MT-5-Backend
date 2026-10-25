import mongoose from "mongoose";
import bcrypt from "bcrypt";
import Broker from "../models/Broker.model.js";
import BrokerMembership from "../models/BrokerMembership.model.js";
import User from "../models/User.model.js";
import Auth from "../models/Auth.model.js";
import {
  ALL_BROKER_PERMISSIONS,
  BROKER_PERMISSIONS,
  BROKER_STATUS,
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUS,
  PLATFORM_ROLES,
} from "../constants/brokerPermissions.js";

const rounds = () => Number(process.env.BCRYPT_ROUNDS || 10);

export async function listBrokersService() {
  return Broker.find({}).sort({ createdAt: -1 }).lean();
}

export async function createBrokerService({
  code,
  displayName,
  legalName,
  createdBy,
  baseCurrency,
  timezone,
}) {
  const c = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  if (!c || c.length < 2) throw new Error("Invalid broker code");
  const name = String(displayName || c).trim();
  if (!name) throw new Error("displayName required");

  const existing = await Broker.findOne({ code: c }).lean();
  if (existing) throw new Error("Broker code already exists");

  return Broker.create({
    code: c,
    displayName: name,
    legalName: String(legalName || name).trim(),
    status: BROKER_STATUS.ACTIVE,
    baseCurrency: baseCurrency || "USD",
    timezone: timezone || "Asia/Kolkata",
    createdBy: createdBy || null,
  });
}

export async function updateBrokerService(brokerId, patch) {
  if (!mongoose.isValidObjectId(brokerId)) throw new Error("Invalid brokerId");
  const allowed = [
    "displayName",
    "legalName",
    "status",
    "baseCurrency",
    "timezone",
    "country",
    "branding",
  ];
  const $set = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) $set[k] = patch[k];
  }
  if ($set.status && !Object.values(BROKER_STATUS).includes($set.status)) {
    throw new Error("Invalid status");
  }
  const updated = await Broker.findByIdAndUpdate(
    brokerId,
    { $set },
    { new: true },
  ).lean();
  if (!updated) throw new Error("Broker not found");
  return updated;
}

/**
 * Create Broker Admin user (or attach existing) + membership with permissions.
 */
export async function inviteBrokerAdminService({
  brokerId,
  email,
  password,
  name,
  permissions,
  invitedBy,
}) {
  if (!mongoose.isValidObjectId(brokerId)) throw new Error("Invalid brokerId");
  const broker = await Broker.findById(brokerId).lean();
  if (!broker) throw new Error("Broker not found");

  const mail = String(email || "")
    .trim()
    .toLowerCase();
  if (!mail) throw new Error("Email required");

  let perms = Array.isArray(permissions) ? permissions : ALL_BROKER_PERMISSIONS;
  perms = perms.filter((p) => BROKER_PERMISSIONS.includes(p));
  if (!perms.length) perms = [...ALL_BROKER_PERMISSIONS];

  let user = await User.findOne({ email: mail });
  let tempPassword = null;

  if (!user) {
    const pass = String(password || "").trim() || `Admin@${Date.now().toString().slice(-6)}`;
    tempPassword = pass;
    user = await User.create({
      email: mail,
      name: String(name || mail.split("@")[0]).trim(),
      userType: "ADMIN",
      isMailVerified: true,
      brokerId: broker._id,
      platformRole: null,
    });
    const hash = await bcrypt.hash(pass, rounds());
    await Auth.create({
      user_id: user._id,
      password_hash: hash,
    });
  } else {
    if (user.userType !== "ADMIN") {
      user.userType = "ADMIN";
      await user.save();
    }
    if (!user.brokerId) {
      user.brokerId = broker._id;
      await user.save();
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
    { brokerId: broker._id, userId: user._id },
    {
      $set: {
        role: MEMBERSHIP_ROLES.BROKER_ADMIN,
        permissions: perms,
        status: MEMBERSHIP_STATUS.ACTIVE,
        invitedBy: invitedBy || null,
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
    broker,
    temporaryPassword: tempPassword,
  };
}

export async function listMembershipsService(brokerId) {
  if (!mongoose.isValidObjectId(brokerId)) throw new Error("Invalid brokerId");
  return BrokerMembership.find({ brokerId })
    .populate("userId", "email name userType platformRole")
    .lean();
}

export async function updateMembershipService(membershipId, patch) {
  if (!mongoose.isValidObjectId(membershipId)) {
    throw new Error("Invalid membershipId");
  }
  const $set = {};
  if (patch.status && Object.values(MEMBERSHIP_STATUS).includes(patch.status)) {
    $set.status = patch.status;
  }
  if (Array.isArray(patch.permissions)) {
    $set.permissions = patch.permissions.filter((p) =>
      BROKER_PERMISSIONS.includes(p),
    );
  }
  if (patch.role && Object.values(MEMBERSHIP_ROLES).includes(patch.role)) {
    $set.role = patch.role;
  }
  const updated = await BrokerMembership.findByIdAndUpdate(
    membershipId,
    { $set },
    { new: true },
  ).lean();
  if (!updated) throw new Error("Membership not found");
  return updated;
}

export async function grantSuperAdminService(email) {
  const mail = String(email || "")
    .trim()
    .toLowerCase();
  const user = await User.findOne({ email: mail });
  if (!user) throw new Error("User not found");
  user.userType = "ADMIN";
  user.platformRole = PLATFORM_ROLES.SUPER_ADMIN;
  user.isMailVerified = true;
  await user.save();
  return user.toObject();
}

function slugCodeFromEmail(email, name) {
  const base = String(name || email.split("@")[0] || "ADMIN")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 20);
  const suffix = Date.now().toString(36).toUpperCase().slice(-4);
  return `${base || "ADMIN"}_${suffix}`;
}

/**
 * SuperAdmin creates a normal Admin only.
 * Tenant/broker is auto-created in background for data isolation (not shown in UI).
 */
export async function createAdminService({
  email,
  password,
  name,
  permissions,
  invitedBy,
}) {
  const mail = String(email || "")
    .trim()
    .toLowerCase();
  if (!mail) throw new Error("Email required");

  const existing = await User.findOne({ email: mail }).lean();
  if (existing?.platformRole === PLATFORM_ROLES.SUPER_ADMIN) {
    throw new Error("Cannot create admin on SuperAdmin email");
  }
  if (existing?.userType === "ADMIN" && existing?.brokerId) {
    throw new Error("Admin already exists with this email");
  }

  const displayName = String(name || mail.split("@")[0]).trim() || "Admin";
  const code = slugCodeFromEmail(mail, displayName);

  const broker = await createBrokerService({
    code,
    displayName,
    legalName: displayName,
    createdBy: invitedBy || null,
  });

  return inviteBrokerAdminService({
    brokerId: broker._id,
    email: mail,
    password,
    name: displayName,
    permissions,
    invitedBy,
  });
}

/** List all platform admins (excludes SuperAdmin accounts). */
export async function listAdminsService() {
  const memberships = await BrokerMembership.find({
    role: MEMBERSHIP_ROLES.BROKER_ADMIN,
  })
    .populate("userId", "email name userType platformRole createdAt")
    .populate("brokerId", "code displayName status")
    .sort({ createdAt: -1 })
    .lean();

  return memberships
    .filter((m) => m.userId && m.userId.platformRole !== PLATFORM_ROLES.SUPER_ADMIN)
    .map((m) => ({
      _id: m._id,
      status: m.status,
      role: m.role,
      permissions: m.permissions || [],
      createdAt: m.createdAt,
      user: m.userId
        ? {
            _id: m.userId._id,
            email: m.userId.email,
            name: m.userId.name,
            createdAt: m.userId.createdAt,
          }
        : null,
      // kept for internal use; UI should not emphasize broker
      brokerId: m.brokerId?._id || m.brokerId || null,
    }));
}

export { ALL_BROKER_PERMISSIONS, BROKER_PERMISSIONS, PLATFORM_ROLES };
