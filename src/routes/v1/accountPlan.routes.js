import express from 'express';
import {
  createAccountPlan,
  updateAccountPlan,
  deleteAccountPlan,
  getPlansAdmin,
  getPlansForUser
} from '../../controllers/accountPlan.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

/* USER */
router.get('/active', getPlansForUser);

/* ADMIN */
router.post('/', brokerAdminAuth, createAccountPlan);
router.get('/', brokerAdminAuth, getPlansAdmin);
router.put('/:id', brokerAdminAuth, updateAccountPlan);
router.delete('/:id', brokerAdminAuth, deleteAccountPlan);

export default router;
