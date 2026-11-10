import AppRelease from "./appUpdate.model.js";
import { envDefaults } from "./appUpdate.constants.js";

function normalizeApkUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "/downloads/Oceana.apk";
  // Old MetaTrader update path → Oceana APK (same file, new name).
  if (/MetaTrader5\.apk$/i.test(raw) || /\/app\.apk$/i.test(raw)) {
    if (raw.startsWith("http")) {
      return raw.replace(/MetaTrader5\.apk$/i, "Oceana.apk").replace(
        /\/app\.apk$/i,
        "/Oceana.apk",
      );
    }
    return "/downloads/Oceana.apk";
  }
  return raw;
}

function toPublic(doc, platform) {
  const src = doc || envDefaults();
  return {
    platform,
    latestVersionName: src.latestVersionName,
    latestVersionCode: Number(src.latestVersionCode) || 0,
    apkUrl: normalizeApkUrl(src.apkUrl),
    force: Boolean(src.force),
    releaseNotes: src.releaseNotes || "",
    updatedAt: doc?.updatedAt || null,
  };
}

/** App startup par: latest build kaunsa hai aur force hai ya nahi. */
export async function getReleaseInfo(platform) {
  const doc = await AppRelease.findOne({ platform }).lean();
  return toPublic(doc, platform);
}

/**
 * Admin: naya APK release set karo. Pehli baar row banate waqt version,
 * code aur apkUrl teeno zaroori.
 */
export async function upsertRelease({ platform, updatedBy, ...fields }) {
  const existing = await AppRelease.findOne({ platform }).lean();
  if (!existing) {
    const missing = ["latestVersionName", "latestVersionCode", "apkUrl"].filter(
      (k) => fields[k] === undefined,
    );
    if (missing.length) {
      const err = new Error(`Required for first release: ${missing.join(", ")}`);
      err.status = 400;
      throw err;
    }
  }

  const doc = await AppRelease.findOneAndUpdate(
    { platform },
    { $set: { ...fields, updatedBy: updatedBy || null } },
    { new: true, upsert: true, runValidators: true },
  ).lean();
  return toPublic(doc, platform);
}
