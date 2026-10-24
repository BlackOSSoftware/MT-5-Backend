import jwt from "jsonwebtoken";
import User from "../models/User.model.js";
import { verifyAccountToken } from "../utils/jwt.util.js";

/**
 * Accepts either portal access JWT or trade/watch account JWT.
 * Used only for presence heartbeat / offline.
 */
export async function presenceAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        success: false,
        message: "Authorization header missing",
      });
    }

    const parts = String(authHeader).trim().split(/\s+/);
    const token =
      parts.length === 2 && parts[0].toLowerCase() === "bearer"
        ? parts[1]
        : parts[0];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    // 1) Portal access token
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (decoded?.uid) {
        const user = await User.findById(decoded.uid).select("_id").lean();
        if (user) {
          req.user = { _id: user._id };
          req.presenceSource = "access";
          return next();
        }
      }
    } catch {
      // try account token next
    }

    // 2) Trade / watch account token
    try {
      const decoded = verifyAccountToken(token);
      if (decoded?.userId) {
        req.user = { _id: decoded.userId };
        req.presenceSource = "trade";
        req.account = decoded;
        return next();
      }
    } catch {
      // fall through
    }

    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  } catch {
    return res.status(500).json({
      success: false,
      message: "Authentication failed",
    });
  }
}
