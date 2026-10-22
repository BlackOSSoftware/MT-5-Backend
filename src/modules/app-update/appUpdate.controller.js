import { getReleaseInfo, upsertRelease } from "./appUpdate.service.js";
import { parsePlatform, parseReleaseBody } from "./appUpdate.validator.js";

function sendError(res, err, fallback) {
  const status = Number(err?.status) || 500;
  if (status >= 500) console.error("[APP-UPDATE]", err?.message);
  return res.status(status).json({
    success: false,
    message: err?.message || fallback,
  });
}

export async function getUpdateInfoController(req, res) {
  try {
    const data = await getReleaseInfo(parsePlatform(req.query.platform));
    return res.json({ success: true, data });
  } catch (err) {
    return sendError(res, err, "Failed to load update info");
  }
}

export async function upsertReleaseController(req, res) {
  try {
    const data = await upsertRelease({
      ...parseReleaseBody(req.body),
      updatedBy: req.user?._id,
    });
    return res.json({ success: true, message: "App release updated", data });
  } catch (err) {
    return sendError(res, err, "Failed to update app release");
  }
}
