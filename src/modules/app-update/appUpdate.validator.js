// /v1/app-update request validation.
import {
  DEFAULT_PLATFORM,
  MAX_RELEASE_NOTES,
  PLATFORMS,
} from "./appUpdate.constants.js";

export class AppUpdateValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AppUpdateValidationError";
    this.status = 400;
  }
}

export function parsePlatform(value) {
  const platform = String(value || DEFAULT_PLATFORM)
    .trim()
    .toLowerCase();
  if (!PLATFORMS.includes(platform)) {
    throw new AppUpdateValidationError(
      `Invalid platform. Use one of: ${PLATFORMS.join(", ")}`,
    );
  }
  return platform;
}

function parseBool(value, field) {
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["true", "1", "yes"].includes(s)) return true;
  if (["false", "0", "no"].includes(s)) return false;
  throw new AppUpdateValidationError(`${field} must be true or false`);
}

/** Admin PUT body - sirf bheje gaye fields badalte hain. */
export function parseReleaseBody(body = {}) {
  const out = { platform: parsePlatform(body.platform) };

  if (body.latestVersionName !== undefined) {
    const name = String(body.latestVersionName).trim();
    if (!/^\d+(\.\d+){0,3}$/.test(name)) {
      throw new AppUpdateValidationError(
        "latestVersionName must look like 1.0.2",
      );
    }
    out.latestVersionName = name;
  }

  if (body.latestVersionCode !== undefined) {
    const code = Number(body.latestVersionCode);
    if (!Number.isInteger(code) || code < 1) {
      throw new AppUpdateValidationError(
        "latestVersionCode must be a positive integer",
      );
    }
    out.latestVersionCode = code;
  }

  if (body.apkUrl !== undefined) {
    const url = String(body.apkUrl).trim();
    const isPath = url.startsWith("/");
    const isHttp = /^https?:\/\/\S+$/i.test(url);
    if (!isPath && !isHttp) {
      throw new AppUpdateValidationError(
        "apkUrl must be an http(s) URL or a /downloads/... path",
      );
    }
    out.apkUrl = url;
  }

  if (body.force !== undefined) out.force = parseBool(body.force, "force");

  if (body.releaseNotes !== undefined) {
    const notes = String(body.releaseNotes);
    if (notes.length > MAX_RELEASE_NOTES) {
      throw new AppUpdateValidationError(
        `releaseNotes must be at most ${MAX_RELEASE_NOTES} characters`,
      );
    }
    out.releaseNotes = notes;
  }

  if (Object.keys(out).length === 1) {
    throw new AppUpdateValidationError("Nothing to update");
  }
  return out;
}
