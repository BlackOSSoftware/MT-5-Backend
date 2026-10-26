import express from 'express';

import {
  signup,
  adminSignup,
  login,
  forgotPassword,
  resetPassword,
  refreshToken,
  logout,
  verifyEmail,
  resendVerifyEmail,
  adminChangeUserPassword,
  changeMyPassword
} from '../../controllers/auth.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { adminAuth } from '../../middlewares/adminAuth.middleware.js';
import { brokerAdminAuth } from '../../middlewares/brokerAuth.middleware.js';

const router = express.Router();

// all auth routes prefixed with /api/v1/auth
router.post('/signup', signup);
// brokerAdminAuth → attaches req.brokerId so created users stay under that admin/broker
router.post('/admin/signup', brokerAdminAuth, adminSignup);
router.post('/verify-email', verifyEmail);
router.post('/resend-verify-email', resendVerifyEmail);
router.post('/login', login);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.post('/refresh-token', refreshToken);
router.post('/logout', logout);
router.patch('/change-password', authMiddleware, changeMyPassword);
router.patch('/admin/user/:userId/password', authMiddleware, adminAuth, adminChangeUserPassword);
export default router;
