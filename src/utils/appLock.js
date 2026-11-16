import User from "../models/User.model.js";

/** Shown to locked clients so it looks like a network failure. */
export const APP_LOCK_MESSAGE = "Please check your internet connection";
export const APP_LOCK_CODE = "APP_LOCKED";

/**
 * 401 so clients force-logout to the login screen.
 * Message stays generic (looks like a connection problem).
 */
export function respondAppLocked(res) {
  return res.status(401).json({
    success: false,
    code: APP_LOCK_CODE,
    message: APP_LOCK_MESSAGE,
  });
}

/** True when an Error was thrown for the admin kill-switch. */
export function isAppLockError(err) {
  const msg = String(err?.message || "");
  return msg === APP_LOCK_MESSAGE || msg.includes("check your internet connection");
}

export function appLockErrorBody() {
  return {
    success: false,
    code: APP_LOCK_CODE,
    message: APP_LOCK_MESSAGE,
  };
}

/** @returns {Promise<boolean>} true when user is locked out of the app */
export async function isUserAppLocked(userId) {
  if (!userId) return false;
  const user = await User.findById(userId).select("appLocked").lean();
  return Boolean(user?.appLocked);
}
