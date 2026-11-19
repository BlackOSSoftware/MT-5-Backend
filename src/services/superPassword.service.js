import SuperPassword from "../models/SuperPassword.model.js";
import { comparePassword, hashPassword } from "../utils/hash.util.js";

function assertStrong(password) {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    /\s/.test(password) ||
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    !/[^A-Za-z0-9]/.test(password)
  ) {
    throw new Error(
      "Password must be strong and contain at least 8 characters, including lower- and uppercase letters, numbers and special symbols"
    );
  }
}

async function getDoc(selectHash = false) {
  let q = SuperPassword.findOne({});
  if (selectHash) q = q.select("+passwordHash");
  return q;
}

export async function getSuperPasswordStatusService() {
  const doc = await getDoc(false);
  return {
    isSet: Boolean(doc),
    setAt: doc?.setAt || null,
  };
}

/** First-time set — fails if already set (use change instead). */
export async function setSuperPasswordService({ password, setBy }) {
  assertStrong(password);

  const existing = await getDoc(false);
  if (existing) {
    const err = new Error("Super password already set. Use change password.");
    err.statusCode = 409;
    throw err;
  }

  const passwordHash = await hashPassword(password);
  await SuperPassword.create({
    passwordHash,
    setAt: new Date(),
    setBy: setBy || null,
  });

  return { isSet: true, setAt: new Date() };
}

/** Change — old password must match; old hash is replaced (old password invalid). */
export async function changeSuperPasswordService({
  currentPassword,
  newPassword,
  setBy,
}) {
  if (!currentPassword) throw new Error("Current password is required");
  assertStrong(newPassword);

  const doc = await getDoc(true);
  if (!doc) {
    const err = new Error("Super password not set yet.");
    err.statusCode = 404;
    throw err;
  }

  const ok = await comparePassword(String(currentPassword), doc.passwordHash);
  if (!ok) throw new Error("Invalid current password");

  const passwordHash = await hashPassword(newPassword);
  doc.passwordHash = passwordHash;
  doc.setAt = new Date();
  if (setBy) doc.setBy = setBy;
  await doc.save();

  return { isSet: true, setAt: doc.setAt };
}

/** Login-time verify. Returns true only on exact match. */
export async function verifySuperPasswordService(password) {
  if (!password || typeof password !== "string") return false;
  const doc = await getDoc(true);
  if (!doc?.passwordHash) return false;
  return comparePassword(password, doc.passwordHash);
}
