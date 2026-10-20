import {
  accountLoginService,
  getAccountProfileService,
  resetTradePasswordService,
  resetWatchPasswordService,
  adminResetTradePasswordService,
  adminResetWatchPasswordService,
} from "../services/accountAuth.service.js";

/* =====================================================
   HELPERS (CONTROLLER LEVEL VALIDATION)
===================================================== */
function normalizePassword(password) {
  if (typeof password !== "string") {
    throw new Error("Password is required");
  }

  // remove leading & trailing spaces
  const trimmed = password.trim();

  if (!trimmed) {
    throw new Error("Password is required");
  }

  // block any whitespace inside password
  if (/\s/.test(trimmed)) {
    throw new Error("Password must not contain spaces");
  }

  if (trimmed.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  return trimmed;
}

/* =====================================================
   ACCOUNT LOGIN
===================================================== */
export async function accountLoginController(req, res) {
  try {
    const { account_number, password } = req.body;

    if (!account_number || !password) {
      return res.status(400).json({
        message: "Account number and password are required",
      });
    }

    const result = await accountLoginService({
      account_number: String(account_number).trim(),
      password: String(password).trim(),
      ip: req.ip,
      device: req.headers["user-agent"] || "unknown",
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

/* =====================================================
   ACCOUNT PROFILE (ACCOUNT TOKEN)
===================================================== */
export async function getAccountProfileController(req, res) {
  try {
    const accountId = req.account?.accountId;
    if (!accountId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const result = await getAccountProfileService({ accountId });
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

/* =====================================================
   RESET TRADE PASSWORD
===================================================== */
export async function resetTradePasswordController(req, res) {
  try {
    const userId = req.user?._id;
    const { accountId } = req.params;
    const { newPassword } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!accountId) {
      return res.status(400).json({ message: "Account ID is required" });
    }

    // ✅ controller-level password validation
    const cleanPassword = normalizePassword(newPassword);

    const result = await resetTradePasswordService({
      userId,
      accountId,
      newPassword: cleanPassword,
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

/* =====================================================
   RESET WATCH PASSWORD
===================================================== */
export async function resetWatchPasswordController(req, res) {
  try {
    const userId = req.user?._id;
    const { accountId } = req.params;
    const { newPassword } = req.body;

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!accountId) {
      return res.status(400).json({ message: "Account ID is required" });
    }

    // ✅ controller-level password validation
    const cleanPassword = normalizePassword(newPassword);

    const result = await resetWatchPasswordService({
      userId,
      accountId,
      newPassword: cleanPassword,
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

/* =====================================================
   ADMIN RESET TRADE PASSWORD
===================================================== */
export async function adminResetTradePasswordController(req, res) {
  try {
    const { accountId } = req.params;
    const { newPassword } = req.body;

    if (!accountId) {
      return res.status(400).json({ message: "Account ID is required" });
    }

    const result = await adminResetTradePasswordService({
      accountId,
      newPassword,
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

/* =====================================================
   ADMIN RESET WATCH PASSWORD
===================================================== */
export async function adminResetWatchPasswordController(req, res) {
  try {
    const { accountId } = req.params;
    const { newPassword } = req.body;

    if (!accountId) {
      return res.status(400).json({ message: "Account ID is required" });
    }

    const result = await adminResetWatchPasswordService({
      accountId,
      newPassword,
    });

    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}
