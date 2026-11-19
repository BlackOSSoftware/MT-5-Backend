import {
  getSuperPasswordStatusService,
  setSuperPasswordService,
  changeSuperPasswordService,
} from "../services/superPassword.service.js";

function fail(res, err) {
  return res.status(err.statusCode || 400).json({
    success: false,
    message: err.message,
  });
}

export async function getSuperPasswordStatusController(req, res) {
  try {
    const data = await getSuperPasswordStatusService();
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return fail(res, err);
  }
}

export async function setSuperPasswordController(req, res) {
  try {
    const { password } = req.body || {};
    const data = await setSuperPasswordService({
      password,
      setBy: req.user?._id || null,
    });
    return res.status(201).json({
      success: true,
      message: "Super password set successfully",
      data,
    });
  } catch (err) {
    return fail(res, err);
  }
}

export async function changeSuperPasswordController(req, res) {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const data = await changeSuperPasswordService({
      currentPassword,
      newPassword,
      setBy: req.user?._id || null,
    });
    return res.status(200).json({
      success: true,
      message: "Super password changed successfully",
      data,
    });
  } catch (err) {
    return fail(res, err);
  }
}
