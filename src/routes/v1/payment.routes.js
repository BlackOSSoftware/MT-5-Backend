import express from 'express';
import {
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  togglePaymentMethod,
  getAllPaymentMethods,
  getActivePaymentMethods
} from '../../controllers/payment.controller.js';

import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

// user only active routes 
router.get('/active',authMiddleware,getActivePaymentMethods);

/* ADMIN only */
router.get('/all', brokerAdminAuth, getAllPaymentMethods);
router.post('/', brokerAdminAuth, createPaymentMethod);
router.put('/:id', brokerAdminAuth, updatePaymentMethod);
router.patch('/:id/status', brokerAdminAuth, togglePaymentMethod);
router.delete('/:id', brokerAdminAuth, deletePaymentMethod);

export default router;
