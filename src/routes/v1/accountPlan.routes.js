import express from 'express';
import {
  createAccountPlan,
  updateAccountPlan,
  deleteAccountPlan,
  getPlansAdmin,
  getPlansForUser
} from '../../controllers/accountPlan.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth, requireBrokerPermission } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/* USER — broker-scoped (only plans of the logged-in user's broker) */
router.get('/active', authMiddleware, getPlansForUser);

/* ADMIN */
router.post('/', brokerAdminAuth, requireBrokerPermission('plans.manage'), createAccountPlan);
router.get('/', brokerAdminAuth, requireBrokerPermission('plans.manage'), getPlansAdmin);
router.put('/:id', brokerAdminAuth, requireBrokerPermission('plans.manage'), updateAccountPlan);
router.delete('/:id', brokerAdminAuth, requireBrokerPermission('plans.manage'), deleteAccountPlan);

export default router;
