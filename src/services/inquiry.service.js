import Inquiry from '../models/Inquiry.model.js';
import User from '../models/User.model.js';

/**
 * CREATE INQUIRY
 */
export function createInquiryService(payload) {
  return Inquiry.create(payload);
}

/**
 * GET INQUIRIES (ADMIN)
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
