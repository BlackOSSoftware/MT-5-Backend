import mongoose from "mongoose";
import Broker from "../models/Broker.model.js";
import BrokerMembership from "../models/BrokerMembership.model.js";
import {
  BROKER_STATUS,
  MEMBERSHIP_STATUS,
  PLATFORM_ROLES,
} from "../constants/brokerPermissions.js";
import { adminAuth } from "./adminAuth.middleware.js";

function isSuperAdmin(user) {
  return user?.platformRole === PLATFORM_ROLES.SUPER_ADMIN;
}

/**
 * After adminAuth: resolve active broker + membership into req.broker / req.membership.
 * Header: x-broker-id (optional for SuperAdmin cross-broker; required for Broker Admin).
 */
export async function resolveBrokerContext(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const headerBroker = String(req.headers["x-broker-id"] || "").trim();
    const queryBroker = String(req.query?.brokerId || "").trim();
    const bodyBroker = String(req.body?.brokerId || "").trim();

    // SuperAdmin: same admin panel, but NO broker filter by default (all data).
    // Only narrow if frontend explicitly sends x-broker-id / brokerId.
    if (isSuperAdmin(req.user)) {
      req.isSuperAdmin = true;
      const explicit =
        headerBroker || queryBroker || bodyBroker;
      if (explicit && mongoose.isValidObjectId(explicit)) {
        const broker = await Broker.findById(explicit).lean();
        if (!broker) {
          return res.status(404).json({ success: false, message: "Broker not found" });
        }
        req.brokerId = broker._id;
        req.broker = broker;
        req.membership = null;
        req.permissions = ["*"];
      } else {
        req.brokerId = null;
        req.broker = null;
        req.membership = null;
        req.permissions = ["*"];
      }
      return next();
    }

    const requested =
      headerBroker || queryBroker || bodyBroker || String(req.user.brokerId || "");

    // Broker Admin / staff — must have membership
    const memberships = await BrokerMembership.find({
      userId: req.user._id,
      status: MEMBERSHIP_STATUS.ACTIVE,
    }).lean();

    if (!memberships.length) {
      // Legacy ADMIN (pre-membership): only if user.brokerId is set (scoped).
      if (req.user.userType === "ADMIN" && req.user.brokerId) {
        req.isSuperAdmin = false;
        req.brokerId = req.user.brokerId;
        req.broker = await Broker.findById(req.brokerId).lean();
        req.membership = null;
        req.permissions = ["*"];
        return next();
      }
      return res.status(403).json({
        success: false,
        message: "No active broker membership",
      });
    }

    let membership = null;
    if (requested && mongoose.isValidObjectId(requested)) {
      membership = memberships.find(
        (m) => String(m.brokerId) === String(requested),
      );
      if (!membership) {
        return res.status(403).json({
          success: false,
          message: "Not a member of this broker",
        });
      }
    } else if (memberships.length === 1) {
      membership = memberships[0];
    } else {
      return res.status(400).json({
        success: false,
        message: "x-broker-id header required (multiple broker memberships)",
        memberships: memberships.map((m) => ({
          brokerId: m.brokerId,
          role: m.role,
        })),
      });
    }

    const broker = await Broker.findById(membership.brokerId).lean();
    if (!broker || broker.status === BROKER_STATUS.SUSPENDED) {
      return res.status(403).json({
        success: false,
        message: "Broker is suspended or missing",
      });
    }

    req.isSuperAdmin = false;
    req.brokerId = broker._id;
    req.broker = broker;
    req.membership = membership;
    req.permissions = membership.permissions || [];

    if (!req.brokerId) {
      return res.status(403).json({
        success: false,
        message: "Broker scope required",
      });
    }
    return next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || "Broker context failed",
    });
  }
}

/** adminAuth → then broker context */
export function brokerAdminAuth(req, res, next) {
  return adminAuth(req, res, () => resolveBrokerContext(req, res, next));
}

export function requireSuperAdmin(req, res, next) {
  return adminAuth(req, res, () => {
    if (!isSuperAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "SuperAdmin access required",
      });
    }
    req.isSuperAdmin = true;
    return next();
  });
}

export function requireBrokerPermission(...needed) {
  return (req, res, next) => {
    if (req.isSuperAdmin || req.permissions?.includes("*")) return next();
    const ok = needed.every((p) => req.permissions?.includes(p));
    if (!ok) {
      return res.status(403).json({
        success: false,
        message: `Missing permission: ${needed.join(", ")}`,
      });
    }
    return next();
  };
}

/** Helper: force broker filter on queries */
export function brokerScopeFilter(req, extra = {}) {
  if (req.brokerId) return { ...extra, brokerId: req.brokerId };
  // SuperAdmin without broker context = platform-wide (explicit)
  return { ...extra };
}
