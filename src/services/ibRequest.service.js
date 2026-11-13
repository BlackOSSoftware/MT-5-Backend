import mongoose from "mongoose";
import IbRequest from "../models/IbRequest.model.js";
import Referral from "../models/Referral.model.js";
import User from "../models/User.model.js";

const USER_SELECT = "name email phone";

function serialize(doc) {
  if (!doc) return null;
  const requester = doc.requester && typeof doc.requester === "object"
    ? doc.requester
    : null;
  const ib = doc.ib && typeof doc.ib === "object" ? doc.ib : null;
  const respondedBy = doc.respondedBy && typeof doc.respondedBy === "object"
    ? doc.respondedBy
    : null;
  return {
    id: String(doc._id),
    status: doc.status,
    note: doc.note || "",
    rejectionReason: doc.rejectionReason || "",
    createdAt: doc.createdAt,
    respondedAt: doc.respondedAt || null,
    requester: requester
      ? {
          id: String(requester._id),
          name: requester.name,
          email: requester.email,
          phone: requester.phone || "",
        }
      : { id: String(doc.requester), name: "", email: "", phone: "" },
    ib: ib
      ? { id: String(ib._id), name: ib.name, email: ib.email, phone: ib.phone || "" }
      : { id: String(doc.ib), name: "", email: "", phone: "" },
    respondedBy: respondedBy
      ? { id: String(respondedBy._id), name: respondedBy.name || "", email: respondedBy.email || "" }
      : null,
  };
}

/** Client asks their direct referrer to become a Sub-IB. */
export async function createSubIbRequestService({ userId, note = "" }) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");

  const myReferral = await Referral.findOne({ user_id: userId })
    .select("referred_by")
    .lean();
  if (!myReferral?.referred_by) {
    throw new Error("You are not referred by an IB yet");
  }
  const ibId = String(myReferral.referred_by);
  if (ibId === String(userId)) {
    throw new Error("Invalid referral relationship");
  }

  const existing = await IbRequest.findOne({
    requester: userId,
    ib: ibId,
  }).sort({ createdAt: -1 }).lean();
  if (existing) {
    if (existing.status === "PENDING") {
      throw new Error("You already have a pending Sub-IB request");
    }
    if (existing.status === "APPROVED") {
      throw new Error("Your Sub-IB request was already approved");
    }
    throw new Error("Your Sub-IB request was rejected — you cannot request again");
  }

  const doc = await IbRequest.create({
    requester: userId,
    ib: ibId,
    note: String(note || "").slice(0, 500),
  });

  const populated = await IbRequest.findById(doc._id)
    .populate("requester", USER_SELECT)
    .populate("ib", USER_SELECT)
    .lean();
  return serialize(populated);
}

/** IB lists incoming Sub-IB requests (optionally filtered by status). */
export async function listSubIbRequestsService({ ibId, status = "", page = 1, limit = 50 }) {
  if (!mongoose.isValidObjectId(ibId)) throw new Error("Invalid userId");
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));

  const filter = { ib: ibId };
  if (["PENDING", "APPROVED", "REJECTED"].includes(String(status).toUpperCase())) {
    filter.status = String(status).toUpperCase();
  }

  const [items, total, counts] = await Promise.all([
    IbRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("requester", USER_SELECT)
      .populate("ib", USER_SELECT)
      .populate("respondedBy", "name email")
      .lean(),
    IbRequest.countDocuments(filter),
    IbRequest.aggregate([
      { $match: { ib: new mongoose.Types.ObjectId(ibId) } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const statusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const c of counts) {
    if (c._id && statusCounts[c._id] !== undefined) statusCounts[c._id] = c.count;
  }

  return {
    items: items.map(serialize),
    statusCounts,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

/**
 * Admin: all Sub-IB requests related to a user — both as the IB
 * (requests they received) and as the requester (requests they sent).
 */
export async function listUserIbRequestsService({
  userId,
  status = "",
  page = 1,
  limit = 50,
}) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));

  const filter = {
    $or: [{ ib: userId }, { requester: userId }],
  };
  if (["PENDING", "APPROVED", "REJECTED"].includes(String(status).toUpperCase())) {
    filter.status = String(status).toUpperCase();
  }

  const [items, total, counts] = await Promise.all([
    IbRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("requester", USER_SELECT)
      .populate("ib", USER_SELECT)
      .populate("respondedBy", "name email")
      .lean(),
    IbRequest.countDocuments(filter),
    IbRequest.aggregate([
      {
        $match: {
          $or: [
            { ib: new mongoose.Types.ObjectId(userId) },
            { requester: new mongoose.Types.ObjectId(userId) },
          ],
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  const statusCounts = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const c of counts) {
    if (c._id && statusCounts[c._id] !== undefined) statusCounts[c._id] = c.count;
  }

  return {
    items: items.map((doc) => ({
      ...serialize(doc),
      direction:
        String(doc.ib?._id || doc.ib) === String(userId)
          ? "RECEIVED"
          : "SENT",
    })),
    statusCounts,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
  };
}

/**
 * Status for a referred client: who their IB is + latest request + access flag.
 * Safe for non-IB users (no IB dashboard gate needed).
 */
export async function getIbRequestStatusService({ userId }) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");

  const [me, myReferral, latestRequest] = await Promise.all([
    User.findById(userId).select("ibDashboardEnabled").lean(),
    Referral.findOne({ user_id: userId }).select("referred_by").lean(),
    IbRequest.findOne({ requester: userId })
      .sort({ createdAt: -1 })
      .populate("requester", USER_SELECT)
      .populate("ib", USER_SELECT)
      .lean(),
  ]);

  let ib = null;
  if (myReferral?.referred_by) {
    const ibUser = await User.findById(myReferral.referred_by)
      .select("name email")
      .lean();
    if (ibUser) {
      ib = { id: String(ibUser._id), name: ibUser.name || "", email: ibUser.email || "" };
    }
  }

  return {
    ibDashboardEnabled: Boolean(me?.ibDashboardEnabled),
    referredBy: ib,
    request: serialize(latestRequest),
  };
}

/** Client checks their own Sub-IB request status with their IB. */
export async function getMySubIbRequestService({ userId }) {
  if (!mongoose.isValidObjectId(userId)) throw new Error("Invalid userId");
  const doc = await IbRequest.findOne({ requester: userId })
    .sort({ createdAt: -1 })
    .populate("requester", USER_SELECT)
    .populate("ib", USER_SELECT)
    .lean();
  return serialize(doc);
}

/** IB approves or rejects a Sub-IB request. */
export async function respondSubIbRequestService({ ibId, requestId, action, reason = "" }) {
  if (!mongoose.isValidObjectId(ibId) || !mongoose.isValidObjectId(requestId)) {
    throw new Error("Invalid request");
  }
  const act = String(action || "").toUpperCase();
  if (!["APPROVE", "REJECT"].includes(act)) {
    throw new Error("Action must be APPROVE or REJECT");
  }

  const doc = await IbRequest.findOne({ _id: requestId, ib: ibId });
  if (!doc) {
    const err = new Error("Sub-IB request not found");
    err.status = 404;
    throw err;
  }
  if (doc.status !== "PENDING") {
    throw new Error(`Request already ${doc.status.toLowerCase()}`);
  }

  doc.status = act === "APPROVE" ? "APPROVED" : "REJECTED";
  doc.respondedBy = ibId;
  doc.respondedAt = new Date();
  doc.rejectionReason = act === "REJECT" ? String(reason || "").slice(0, 300) : "";
  await doc.save();

  if (act === "APPROVE") {
    // Grant the requester IB dashboard access so they can use the IB portal.
    await User.updateOne(
      { _id: doc.requester },
      { $set: { ibDashboardEnabled: true } },
    );
  }

  const populated = await IbRequest.findById(doc._id)
    .populate("requester", USER_SELECT)
    .populate("ib", USER_SELECT)
    .lean();
  return serialize(populated);
}
