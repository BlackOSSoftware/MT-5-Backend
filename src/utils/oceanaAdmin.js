/** Admin logins allowed to see the Oceana-only Client Position report. */
export const OCEANA_REPORT_ADMIN_EMAILS = new Set(["admin@oceanaprofx.com"]);

export function isOceanaReportAdmin(user) {
  return OCEANA_REPORT_ADMIN_EMAILS.has(String(user?.email || "").trim().toLowerCase());
}

/** Express guard: 403 unless the logged-in admin is on the allow-list. */
export function requireOceanaReportAdmin(req, res, next) {
  if (isOceanaReportAdmin(req.user)) return next();
  return res.status(403).json({
    success: false,
    message: "This report is restricted to the Oceana admin account",
  });
}
