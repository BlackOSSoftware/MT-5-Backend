import {
  createAccount,
  getUserAccounts,
  getUserAccountDetail,
  resetDemoAccount,
  setAccountLeverage,
  adminListUserAccounts,
  adminSearchAccounts,
  adminUpdateAccountService,
  adminDeleteAccountService
} from "../services/account.service.js";

export async function createAccountController(req, res) {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const {
      account_plan_id,
      account_type,
      opening_balance
    } = req.body;

    if (!account_plan_id || !account_type ) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const data = await createAccount({
      userId: req.user._id,
      account_plan_id,
      account_type,
      opening_balance
    });

    return res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message
    });
  }
}

export async function getMyAccounts(req, res) {
  try {
    const data = await getUserAccounts(req.user._id);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getMyAccountDetail(req, res) {
  try {
    const data = await getUserAccountDetail({
      userId: req.user._id,
      accountId: req.params.id
    });

    res.json({ success: true, data });
  } catch (err) {
    res
      .status(err.statusCode || 500)
      .json({ success: false, message: err.message });
  }
}

export async function resetDemoAccountController(req, res) {
  try {
    const data = await resetDemoAccount({
      userId: req.user._id,
      accountId: req.params.id
    });

    res.json({
      success: true,
      message: "Demo balance reset",
      data
    });
  } catch (err) {
    res
      .status(err.statusCode || 500)
      .json({ success: false, message: err.message });
  }
}

export async function setAccountLeverageController(req, res) {
  try {
    const { id } = req.params;
    const { leverage } = req.body;

    if (!leverage || typeof leverage !== "number") {
      return res.status(400).json({
        success: false,
        message: "Leverage must be a number"
      });
    }

    if (leverage < 1) {
      return res.status(400).json({
        success: false,
        message: "Leverage cannot be less than 1"
      });
    }

    const data = await setAccountLeverage({
      userId: req.user._id,
      accountId: id,
      leverage
    });

    return res.json({
      success: true,
      message: "Leverage updated successfully",
      data
    });
  } catch (err) {
    return res.status(err.statusCode || 400).json({
      success: false,
      message: err.message
    });
  }
}

export async function adminListUserAccountsController(req, res) {
  try {
    const { userId } = req.params;
    const data = await adminListUserAccounts({
      userId,
      query: req.query,
      brokerId: req.brokerId || null,
    });

    return res.json({
      success: true,
      data: data.items,
      pagination: data.pagination
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function adminSearchAccountsController(req, res) {
  try {
    const data = await adminSearchAccounts({
      query: req.query,
      brokerId: req.brokerId || null,
    });

    return res.json({
      success: true,
      data: data.items,
      pagination: data.pagination
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function adminUpdateAccountController(req, res) {
  try {
    const { accountId } = req.params;
    const data = await adminUpdateAccountService({
      accountId,
      payload: req.body,
      brokerId: req.brokerId || null,
    });

    return res.json({
      success: true,
      message: "Account updated successfully",
      data
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message
    });
  }
}

export async function adminDeleteAccountController(req, res) {
  try {
    const { accountId } = req.params;
    const data = await adminDeleteAccountService({
      accountId,
      brokerId: req.brokerId || null,
    });

    return res.json({
      success: true,
      message: "Account deleted successfully",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      message: err.message,
    });
  }
}
