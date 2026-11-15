import express from 'express';
import {
  createInquiry,
  getInquiries,
  getMyInquiries,
  updateInquiryStatus,
} from '../../controllers/inquiry.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth, requireBrokerPermission } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/**
 * USER (authenticated portal)
 */
router.get('/mine', authMiddleware, getMyInquiries);

/**
 * USER / PUBLIC create
 * If Bearer token present, authMiddleware attaches req.user for userId stamp.
 */
router.post('/', (req, res) => {
  const auth = req.headers.authorization;
  if (auth && String(auth).startsWith('Bearer ')) {
    return authMiddleware(req, res, () => createInquiry(req, res));
  }
  return createInquiry(req, res);
});

/**
 * ADMIN
 */
router.get('/', brokerAdminAuth, requireBrokerPermission('inquiry.manage'), getInquiries);
router.patch('/:id/status', brokerAdminAuth, requireBrokerPermission('inquiry.manage'), updateInquiryStatus);

export default router;
