import mongoose from "mongoose";
import IbRequest from "../models/IbRequest.model.js";
import Referral from "../models/Referral.model.js";
import User from "../models/User.model.js";

const USER_SELECT = "name email";

function serialize(doc) {
  if (!doc) return null;
  const requester = doc.requester && typeof doc.requester === "object"
    ? doc.requester
    : null;
  const ib = doc.ib && typeof doc.ib === "object" ? doc.ib : null;
  return {
    id: String(doc._id),
    status: doc.status,
    note: doc.note || "",
    rejectionReason: doc.rejectionReason || "",
    createdAt: doc.createdAt,
    respondedAt: doc.respondedAt || null,
    requester: requester
      ? { id: String(requester._id), name: requester.name, email: requester.email }
      : { id: String(doc.requester), name: "", email: "" },
    ib: ib
      ? { id: String(ib._id), name: ib.name, email: ib.email }
      : { id: String(doc.ib), name: "", email: "" },
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
    status: { $in: ["PENDING", "APPROVED"] },
  }).lean();
  if (existing) {
    throw new Error(
      existing.status === "PENDING"
        ? "You already have a pending Sub-IB request"
        : "Your Sub-IB request was already approved",
    );
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

  const [items, total] = await Promise.all([
    IbRequest.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .populate("requester", USER_SELECT)
      .populate("ib", USER_SELECT)
      .lean(),
    IbRequest.countDocuments(filter),
  ]);

  return {
    items: items.map(serialize),
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
    },
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
