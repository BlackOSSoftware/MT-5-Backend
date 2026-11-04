import {
  createInquiryService,
  getInquiriesService,
  getMyInquiriesService,
  updateInquiryStatusService,
  formatTicketId,
} from '../services/inquiry.service.js';

/**
 * USER CREATE INQUIRY
 */
export async function createInquiry(req, res) {
  try {
    const {
      name,
      email,
      phone,
      title,
      description,
      portalBrokerCode,
      brokerCode,
      brokerId,
    } = req.body;

    if (!name || !title || !description) {
      return res.status(400).json({
        success: false,
        message: 'Name, title and description are required'
      });
    }

    const ip =
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.socket.remoteAddress;

    const inquiry = await createInquiryService({
      name,
      email: email || req.user?.email,
      phone,
      title,
      description,
      portalBrokerCode,
      brokerCode,
      brokerId,
      userId: req.user?._id || null,
      ip
    });

    const ticketId = inquiry?.ticketId || formatTicketId(inquiry?._id);

    return res.status(201).json({
      success: true,
      message: 'Ticket submitted successfully',
      data: {
        ticketId,
        inquiryId: inquiry?._id,
        status: inquiry?.status || 'OPEN',
      },
    });

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to submit inquiry'
    });
  }
}

/**
 * USER — list my tickets
 */
export async function getMyInquiries(req, res) {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Number(req.query.limit) || 20, 100);

    const result = await getMyInquiriesService({
      userId: req.user?._id,
      email: req.user?.email,
      page,
      limit,
    });

    return res.json({
      success: true,
      data: result.data,
      total: result.total,
      page: result.page,
      totalPages: result.totalPages,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error?.message || 'Failed to fetch tickets',
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
    const status = req.query.status || null;

    const result = await getInquiriesService(
      page,
      limit,
      req.brokerId || null,
      status,
    );

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

/**
 * ADMIN — review / close ticket
 */
export async function updateInquiryStatus(req, res) {
  try {
    const { status, adminNote } = req.body || {};
    const inquiry = await updateInquiryStatusService({
      inquiryId: req.params.id,
      status,
      adminNote,
      adminId: req.user?._id,
      brokerId: req.brokerId || null,
    });

    return res.json({
      success: true,
      message: `Ticket marked as ${inquiry.status}`,
      data: inquiry,
    });
  } catch (error) {
    const msg = error?.message || 'Failed to update ticket';
    const code =
      msg.includes('not found') ? 404 :
      msg.includes('already') || msg.includes('must be') || msg.includes('scope') ? 400 :
      500;
    return res.status(code).json({
      success: false,
      message: msg,
    });
  }
}
