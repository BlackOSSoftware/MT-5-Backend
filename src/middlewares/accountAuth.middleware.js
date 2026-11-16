import { verifyAccountToken } from "../utils/jwt.util.js";
import AccountAuth from "../models/AccountAuth.model.js";
import { isUserAppLocked, respondAppLocked } from "../utils/appLock.js";

export async function accountAuthMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const raw = String(header).trim();
    const token = raw.toLowerCase().startsWith("bearer ")
      ? raw.slice(7).trim()
      : raw.split(" ")[1] || raw;

    if (!token) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const decoded = verifyAccountToken(token);

    if (
      !decoded.accountId ||
      !decoded.userId ||
      !decoded.sessionType ||
      !decoded.iat
    ) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    if (decoded.sessionType !== "TRADE" && decoded.sessionType !== "WATCH") {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    if (await isUserAppLocked(decoded.userId)) {
      return respondAppLocked(res);
    }

    // Security: invalidate any previously issued tokens after password reset.
    const authState = await AccountAuth.findOne(
      { account_id: decoded.accountId },
      { is_locked: 1, credentials_last_reset_at: 1 }
    ).lean();

    if (!authState || authState.is_locked) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (authState.credentials_last_reset_at) {
      const resetAtSec = Math.floor(
        new Date(authState.credentials_last_reset_at).getTime() / 1000
      );
      const tokenIatSec = Number(decoded.iat);

      if (!Number.isFinite(tokenIatSec) || tokenIatSec <= 0) {
        return res.status(401).json({ message: "Invalid token payload" });
      }

      if (tokenIatSec < resetAtSec) {
        return res.status(401).json({
          message: "Session expired. Please login again",
        });
      }
    }

    req.account = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
}
