import {
  signupService,
  adminSignupService,
  loginService,
  forgotPasswordService,
  resetPasswordService,
  refreshTokenService,
  logoutService,
  verifyEmailService,
  resendEmailVerificationService,
  adminChangeUserPasswordService,
  changeMyPasswordService
} from '../services/auth.service.js';

/* ================= SIGNUP ================= */

export async function signup(req, res) {
  try {
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.socket?.remoteAddress ||
      null;

    const data = await signupService({
      ...req.body,
      signup_ip: ip
    });

    res.status(201).json({
      success: true,
      data
    });
  } catch (e) {
    res.status(400).json({
      success: false,
      message: e.message
    });
  }
}

/* ================= ADMIN SIGNUP (ADMIN ONLY) ================= */
export async function adminSignup(req, res) {
  try {
    const ip =
      req.headers['x-forwarded-for']?.split(',')[0] ||
      req.socket?.remoteAddress ||
      null;

    // Broker Admin: always scope to their broker.
    // SuperAdmin: optional body.brokerId / x-broker-id to place user under a tenant.
    const brokerId =
      req.brokerId ||
      req.body?.brokerId ||
      req.user?.brokerId ||
      null;

    if (!req.isSuperAdmin && !brokerId) {
      return res.status(403).json({
        success: false,
        message: 'Broker scope required to create users',
      });
    }

    const data = await adminSignupService({
      ...req.body,
      brokerId,
      signup_ip: ip,
      actorId: req.user?._id || null
    });

    return res.status(201).json({
      success: true,
      data
    });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message
    });
  }
}

/* ================= VERIFY EMAIL ================= */

export async function verifyEmail(req, res) {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Verification token is required'
      });
    }

    const data = await verifyEmailService(token);

    return res.json({
      success: true,
      data
    });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message
    });
  }
}

/* ================= RESEND EMAIL VERIFICATION ================= */

export async function resendVerifyEmail(req, res) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    const data = await resendEmailVerificationService(email);

    return res.json({
      success: true,
      data
    });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message
    });
  }
}

/* ================= LOGIN ================= */

export async function login(req, res) {
  try {
    const { email, password, fcmToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    const {
      accessToken,
      refreshToken,
      role,
      platformRole,
      brokerId,
      memberships,
      isMailVerified 
    } = await loginService({
      email,
      password,
      ip: req.ip,
      device: req.headers['user-agent'] || null,
      fcmToken
    });

    return res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        role,
        platformRole: platformRole || null,
        brokerId: brokerId || null,
        memberships: memberships || [],
        isMailVerified,
      }
    });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: 'Invalid credentials'
    });
  }
}



/* ================= FORGOT PASSWORD ================= */

export async function forgotPassword(req, res) {
  try {
    await forgotPasswordService(req.body.email);

    res.json({
      success: true
    });
  } catch (e) {
    res.status(400).json({
      success: false,
      message: e.message
    });
  }
}

/* ================= RESET PASSWORD ================= */

export async function resetPassword(req, res) {
  try {
    await resetPasswordService(
      req.body.token,
      req.body.password
    );

    res.json({
      success: true
    });
  } catch (e) {
    res.status(400).json({
      success: false,
      message: e.message
    });
  }
}

/* ================= REFRESH TOKEN ================= */

export async function refreshToken(req, res) {
  try {
    const data = await refreshTokenService({
      refreshToken: req.body.refreshToken,
      ip: req.ip,
      device: req.headers['user-agent']
    });

    res.json({ success: true, data });
  } catch (e) {
    res.status(401).json({ success: false, message: e.message });
  }
}

/* ================= LOGOUT ================= */

export async function logout(req, res) {
  try {
    await logoutService({
      refreshToken: req.body.refreshToken
    });

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
}

/* ================= ADMIN CHANGE USER PASSWORD ================= */
export async function adminChangeUserPassword(req, res) {
  try {
    const { userId } = req.params;
    const { newPassword } = req.body;

    const data = await adminChangeUserPasswordService(
      userId,
      newPassword,
      req.user?._id || null
    );

    return res.json({
      success: true,
      message: 'Password updated successfully',
      data
    });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message
    });
  }
}

/* ================= USER CHANGE OWN PASSWORD ================= */
export async function changeMyPassword(req, res) {
  try {
    const userId = req.user?._id;
    const { oldPassword, newPassword } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const data = await changeMyPasswordService(
      userId,
      oldPassword,
      newPassword
    );

    return res.json({
      success: true,
      message: 'Password changed successfully',
      data
    });
  } catch (e) {
    return res.status(400).json({
      success: false,
      message: e.message
    });
  }
}
