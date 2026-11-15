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
import { brokerAdminAuth, requireBrokerPermission } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

// user only active routes 
router.get('/active',authMiddleware,getActivePaymentMethods);

/* ADMIN only */
router.get('/all', brokerAdminAuth, requireBrokerPermission('finance.payment_methods.manage'), getAllPaymentMethods);
router.post('/', brokerAdminAuth, requireBrokerPermission('finance.payment_methods.manage'), createPaymentMethod);
router.put('/:id', brokerAdminAuth, requireBrokerPermission('finance.payment_methods.manage'), updatePaymentMethod);
router.patch('/:id/status', brokerAdminAuth, requireBrokerPermission('finance.payment_methods.manage'), togglePaymentMethod);
router.delete('/:id', brokerAdminAuth, requireBrokerPermission('finance.payment_methods.manage'), deletePaymentMethod);

export default router;
