import Inquiry from '../models/Inquiry.model.js';
import User from '../models/User.model.js';
import { getUserBrokerId } from '../utils/brokerScope.js';

/**
 * CREATE INQUIRY
 * Stamp brokerId from matching user email when possible.
 */
export async function createInquiryService(payload) {
  const email = String(payload?.email || '').trim().toLowerCase();
  let brokerId = payload?.brokerId || null;

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
    ...payload,
    ...(brokerId ? { brokerId } : {}),
  });
}

/**
 * GET INQUIRIES (ADMIN)
 * Broker admin: inquiries stamped to broker OR from their users' emails.
 * SuperAdmin (brokerId null): all.
 */
export async function getInquiriesService(page, limit, brokerId = null) {
  const skip = (page - 1) * limit;

  let filter = {};
  if (brokerId) {
    const users = await User.find({ brokerId }).select('email').lean();
    const emails = users.map((u) => u.email).filter(Boolean);
    filter = {
      $or: [
        { brokerId },
        ...(emails.length ? [{ email: { $in: emails } }] : []),
      ],
    };
  }

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
