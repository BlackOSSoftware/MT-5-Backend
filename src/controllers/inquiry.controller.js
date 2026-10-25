import {
  createInquiryService,
  getInquiriesService
} from '../services/inquiry.service.js';

/**
 * USER CREATE INQUIRY
 */
export async function createInquiry(req, res) {
  try {
    const { name, email, phone, title, description } = req.body;

    if (!name || !title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Name, title and description are required'
      });
    }

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.socket.remoteAddress;

    await createInquiryService({
      name,
      email,
      phone,
      title,
      description,
      ip
    });

    return res.status(201).json({
      success: true,
      message: 'Inquiry submitted successfully'
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to submit inquiry'
    });
  }
}

/**
 * ADMIN GET INQUIRIES
 */
export async function getInquiries(req, res) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const result = await getInquiriesService(page, limit, req.brokerId || null);

    return res.json({
      success: true,
      data: result.data,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch inquiries'
    });
  }
}
