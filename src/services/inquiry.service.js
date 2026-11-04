import mongoose from 'mongoose';
import Inquiry, { INQUIRY_STATUS_LIST } from '../models/Inquiry.model.js';
import Broker from '../models/Broker.model.js';
import User from '../models/User.model.js';
import { getUserBrokerId } from '../utils/brokerScope.js';
import { sendTicketReceivedMail } from '../utils/mail.util.js';

export function formatTicketId(id) {
  if (!id) return null;
  return `TKT-${String(id).slice(-8).toUpperCase()}`;
}

function mapInquiry(doc) {
  if (!doc) return null;
  const row = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...row,
    ticketId: formatTicketId(row._id),
    status: row.status || 'OPEN',
  };
}

async function resolveBrokerIdByCodeOrId(target) {
  const value = String(target || '').trim();
  if (!value) return null;
  if (mongoose.isValidObjectId(value)) return value;
  const byCode = await Broker.findOne({
    code: value.toUpperCase(),
    status: 'ACTIVE',
  })
    .select('_id')
    .lean();
  return byCode?._id ? String(byCode._id) : null;
}

/**
 * CREATE INQUIRY
 * Priority: explicit brokerId / portalBrokerCode / brokerCode → matching user email.
 */
export async function createInquiryService(payload) {
  const {
    portalBrokerCode = null,
    brokerCode = null,
    brokerId: payloadBrokerId = null,
    userId: payloadUserId = null,
    ...inquiryFields
  } = payload || {};

  const email = String(inquiryFields?.email || '').trim().toLowerCase();
  let brokerId =
    (await resolveBrokerIdByCodeOrId(payloadBrokerId)) ||
    (await resolveBrokerIdByCodeOrId(portalBrokerCode)) ||
    (await resolveBrokerIdByCodeOrId(brokerCode));

  let userId =
    payloadUserId && mongoose.isValidObjectId(payloadUserId)
      ? payloadUserId
      : null;

  if (!userId && email) {
    const user = await User.findOne({ email })
      .select('_id brokerId')
      .lean();
    if (user?._id) userId = user._id;
    if (!brokerId && user?.brokerId) {
      brokerId = user.brokerId;
    } else if (!brokerId && user?._id) {
      brokerId = await getUserBrokerId(user._id);
    }
  } else if (!brokerId && userId) {
    const user = await User.findById(userId).select('brokerId').lean();
    if (user?.brokerId) brokerId = user.brokerId;
    else brokerId = await getUserBrokerId(userId);
  }

  const inquiry = await Inquiry.create({
    ...inquiryFields,
    status: 'OPEN',
    ...(userId ? { userId } : {}),
    ...(brokerId ? { brokerId } : {}),
  });

  const toEmail = String(inquiry.email || '').trim().toLowerCase();
  if (toEmail) {
    const ticketId = formatTicketId(inquiry._id);
    try {
      await sendTicketReceivedMail({
        email: toEmail,
        name: inquiry.name,
        ticketId,
        title: inquiry.title,
        description: inquiry.description,
        brokerId: inquiry.brokerId || brokerId || null,
        brokerCode: portalBrokerCode || brokerCode || null,
      });
    } catch (err) {
      console.error('[inquiry] ticket confirmation mail failed:', err?.message || err);
    }
  }

  return mapInquiry(inquiry);
}

/**
 * USER — my tickets (by userId, fallback email)
 */
export async function getMyInquiriesService({
  userId,
  email = null,
  page = 1,
  limit = 20,
}) {
  const safePage = Math.max(Number(page) || 1, 1);
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const skip = (safePage - 1) * safeLimit;

  const or = [];
  if (userId && mongoose.isValidObjectId(userId)) {
    or.push({ userId });
  }
  const safeEmail = String(email || '').trim().toLowerCase();
  if (safeEmail) {
    or.push({ email: safeEmail });
  }
  if (!or.length) {
    return { data: [], total: 0, page: safePage, totalPages: 0 };
  }

  const filter = { $or: or };
  const [docs, total] = await Promise.all([
    Inquiry.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    Inquiry.countDocuments(filter),
  ]);

  return {
    data: docs.map(mapInquiry),
    total,
    page: safePage,
    totalPages: total === 0 ? 0 : Math.ceil(total / safeLimit),
  };
}

/**
 * GET INQUIRIES (ADMIN)
 */
export async function getInquiriesService(page, limit, brokerId = null, status = null) {
  const skip = (page - 1) * limit;
  const filter = {};
  if (brokerId) filter.brokerId = brokerId;
  if (status) {
    const safe = String(status).trim().toUpperCase();
    if (INQUIRY_STATUS_LIST.includes(safe)) {
      filter.status = safe;
    }
  }

  const data = await Inquiry.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Inquiry.countDocuments(filter);

  return {
    data: data.map(mapInquiry),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * ADMIN — mark REVIEWED or CLOSED
 */
export async function updateInquiryStatusService({
  inquiryId,
  status,
  adminId,
  adminNote = '',
  brokerId = null,
}) {
  if (!mongoose.isValidObjectId(inquiryId)) {
    throw new Error('Invalid inquiry id');
  }

  const nextStatus = String(status || '').trim().toUpperCase();
  if (!['REVIEWED', 'CLOSED'].includes(nextStatus)) {
    throw new Error('Status must be REVIEWED or CLOSED');
  }

  const inquiry = await Inquiry.findById(inquiryId);
  if (!inquiry) {
    throw new Error('Ticket not found');
  }

  if (brokerId && inquiry.brokerId && String(inquiry.brokerId) !== String(brokerId)) {
    throw new Error('Ticket not in your broker scope');
  }

  if (inquiry.status === 'CLOSED') {
    throw new Error('Ticket is already closed');
  }

  if (nextStatus === 'REVIEWED') {
    if (inquiry.status === 'REVIEWED') {
      throw new Error('Ticket is already reviewed');
    }
    inquiry.status = 'REVIEWED';
    inquiry.reviewedBy = adminId || null;
    inquiry.reviewedAt = new Date();
  }

  if (nextStatus === 'CLOSED') {
    inquiry.status = 'CLOSED';
    inquiry.closedBy = adminId || null;
    inquiry.closedAt = new Date();
    if (!inquiry.reviewedAt) {
      inquiry.reviewedBy = adminId || null;
      inquiry.reviewedAt = new Date();
    }
  }

  if (typeof adminNote === 'string' && adminNote.trim()) {
    inquiry.adminNote = adminNote.trim().slice(0, 2000);
  }

  await inquiry.save();
  return mapInquiry(inquiry);
}
