// App update (APK) module ki settings.
export const PLATFORMS = ["android"];
export const DEFAULT_PLATFORM = "android";

/** Is folder ki files `/downloads/<file>` par milti hain (APK yahan rakho). */
export const DOWNLOADS_DIR = "public/downloads";
export const DOWNLOADS_ROUTE = "/downloads";

/** DB me row na ho to .env se (warna "koi update nahi"). Har call pe padha
 * jata hai kyunki module import ke waqt .env load na hua ho sakta hai. */
export function envDefaults() {
  return {
    latestVersionName: process.env.APP_LATEST_VERSION_NAME || "1.0.0",
    latestVersionCode: Number(process.env.APP_LATEST_VERSION_CODE) || 1,
    apkUrl: process.env.APP_APK_URL || "",
    force: String(process.env.APP_FORCE_UPDATE || "").toLowerCase() === "true",
    releaseNotes: process.env.APP_RELEASE_NOTES || "",
  };
}

export const MAX_RELEASE_NOTES = 2000;
