import mongoose from 'mongoose';
import Inquiry from '../models/Inquiry.model.js';
import Broker from '../models/Broker.model.js';
import User from '../models/User.model.js';
import { getUserBrokerId } from '../utils/brokerScope.js';

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
 * Oceana marketing site always sends portalBrokerCode=OCEANAPROFX so only that admin sees it.
 */
export async function createInquiryService(payload) {
  const {
    portalBrokerCode = null,
    brokerCode = null,
    brokerId: payloadBrokerId = null,
    ...inquiryFields
  } = payload || {};

  const email = String(inquiryFields?.email || '').trim().toLowerCase();
  let brokerId =
    (await resolveBrokerIdByCodeOrId(payloadBrokerId)) ||
    (await resolveBrokerIdByCodeOrId(portalBrokerCode)) ||
    (await resolveBrokerIdByCodeOrId(brokerCode));

  if (!brokerId && email) {
    const user = await User.findOne({ email })
      .select('_id brokerId')
      .lean();
    if (user?.brokerId) {
      brokerId = user.brokerId;
    } else if (user?._id) {
      brokerId = await getUserBrokerId(user._id);
    }
  }

  return Inquiry.create({
    ...inquiryFields,
    ...(brokerId ? { brokerId } : {}),
  });
}

/**
 * GET INQUIRIES (ADMIN)
 * Broker admin: only inquiries stamped to that broker (no cross-broker email leak).
 * SuperAdmin (brokerId null): all.
 */
export async function getInquiriesService(page, limit, brokerId = null) {
  const skip = (page - 1) * limit;
  const filter = brokerId ? { brokerId } : {};

  const data = await Inquiry.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await Inquiry.countDocuments(filter);

  return {
    data,
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
}
