import express from 'express';
import {
  createInquiry,
  getInquiries
} from '../../controllers/inquiry.controller.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/**
 * USER
 */
router.post('/', createInquiry);

/**
 * ADMIN
 */
router.get('/', brokerAdminAuth, getInquiries);

export default router;
