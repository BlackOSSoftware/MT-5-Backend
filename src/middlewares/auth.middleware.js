import jwt from 'jsonwebtoken';
import User from '../models/User.model.js';

export async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header missing'
      });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization format'
      });
    }

    const token = parts[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // 🔥 updated fields
    const user = await User.findById(decoded.uid)
      .select('_id userType isMailVerified platformRole brokerId name email')
      .lean();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // ✅ mail verification check
    if (!user.isMailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Email not verified'
      });
    }

    req.user = user;
    next();
  } catch {
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
}
