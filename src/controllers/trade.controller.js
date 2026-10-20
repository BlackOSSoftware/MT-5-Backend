import { tradeEngine } from "../trade-engine/bootstrap.js";
import Account from "../models/Account.model.js";
import {
  getDealsService,
  getOrdersService,
  getPositionsService,
  getSingleAccountService,
  getTradeSummaryService,
} from "../services/tradeOrder.service.js";
import { getUserPortfolioSummaryService } from "../services/tradePortfolio.service.js";

/* =========================
   COMMON: ACCOUNT OWNERSHIP
========================= */
async function verifyAccountOwnership(userId, accountId) {
  const acc = tradeEngine?.accounts?.get(String(accountId)) || null;
  if (acc) {
    if (String(acc.userId) !== String(userId)) {
      throw new Error("Account does not belong to user");
    }
    if (acc.isBlocked === true) {
      throw new Error("Account is blocked");
    }
    if (typeof acc.status === "string" && acc.status !== "active") {
      throw new Error("Account is inactive");
    }
    return;
  }

  const exists = await Account.exists({
    _id: accountId,
    user_id: userId,
    status: "active",
  });

  if (!exists) {
    throw new Error("Account does not belong to user");
  }
}

/* =========================
   WATCH SESSION GUARD
   (NON-GET APIs ONLY)
========================= */
function rejectWatchSession(req) {
  if (req.account?.sessionType === "WATCH") {
    throw new Error("You do not have trade permission");
  }
}

/* =========================
   MARKET ORDER (BUY / SELL)
========================= */
export async function placeMarketOrderController(req, res) {
  try {
    rejectWatchSession(req);

    const { userId, accountId } = req.account;
    const { symbol, side, volume, stopLoss, takeProfit } = req.body;

    if (!symbol || !side || !volume) {
      return res.status(400).json({
        status: "error",
        message: "symbol, side and volume are required",
      });
    }

    if (side !== "BUY" && side !== "SELL") {
      return res.status(400).json({
        status: "error",
        message: "side must be BUY or SELL",
      });
    }

    await verifyAccountOwnership(userId, accountId);

    const position = tradeEngine.placeMarketOrder({
      accountId,
      symbol: String(symbol).toUpperCase(),
      side,
      volume: Number(volume),
      stopLoss: typeof stopLoss === "number" ? stopLoss : null,
      takeProfit: typeof takeProfit === "number" ? takeProfit : null,
    });

    return res.json({ status: "success", data: position });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message || "Trade failed",
    });
  }
}

/* =========================
   CLOSE OPEN POSITION
========================= */
export async function closePosition(req, res) {
  try {
    rejectWatchSession(req);

    const { userId, accountId } = req.account;
    const { positionId } = req.body;

    if (!positionId) {
      return res.status(400).json({
        status: "error",
        message: "positionId required",
      });
    }

    await verifyAccountOwnership(userId, accountId);

    const result = tradeEngine.squareOffPosition({
      accountId,
      positionId,
      reason: "MANUAL_CLOSE",
    });

    return res.json({ status: "success", data: result });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   PLACE PENDING ORDER
========================= */
export async function placePendingOrderController(req, res) {
  try {
    rejectWatchSession(req);

    const { userId, accountId } = req.account;
    const {
      symbol,
      side,
      orderType,
      price,
      limitPrice,
      volume,
      stopLoss,
      takeProfit,
    } = req.body;

    if (!symbol || !side || !orderType || !price || !volume) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields",
      });
    }

    await verifyAccountOwnership(userId, accountId);

    const order = tradeEngine.placePendingOrder({
      userId,
      accountId,
      symbol: String(symbol).toUpperCase(),
      side,
      orderType,
      price: Number(price),
      limitPrice: typeof limitPrice === "number" ? limitPrice : null,
      volume: Number(volume),
      stopLoss: typeof stopLoss === "number" ? stopLoss : null,
      takeProfit: typeof takeProfit === "number" ? takeProfit : null,
    });

    return res.json({ status: "success", data: order });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   MODIFY OPEN POSITION
========================= */
export async function modifyPositionController(req, res) {
  try {
    rejectWatchSession(req);

    const { userId, accountId } = req.account;
    const { positionId, stopLoss, takeProfit } = req.body;

    if (!positionId) {
      return res.status(400).json({
        status: "error",
        message: "positionId required",
      });
    }

    await verifyAccountOwnership(userId, accountId);

    tradeEngine.modifyPosition({
      accountId,
      positionId,
      stopLoss: typeof stopLoss === "number" ? stopLoss : null,
      takeProfit: typeof takeProfit === "number" ? takeProfit : null,
    });

    return res.json({ status: "success" });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   MODIFY PENDING ORDER
========================= */
export async function modifyPendingOrderController(req, res) {
  try {
    rejectWatchSession(req);

    const { userId, accountId } = req.account;
    const { orderId, price, stopLoss, takeProfit } = req.body;

    if (!orderId || !price) {
      return res.status(400).json({
        status: "error",
        message: "orderId and price required",
      });
    }

    await verifyAccountOwnership(userId, accountId);

    tradeEngine.modifyPendingOrder({
      accountId,
      orderId,
      price: Number(price),
      stopLoss: typeof stopLoss === "number" ? stopLoss : null,
      takeProfit: typeof takeProfit === "number" ? takeProfit : null,
    });

    return res.json({ status: "success" });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   CANCEL PENDING ORDER
========================= */
export async function cancelPendingOrderController(req, res) {
  try {
    rejectWatchSession(req);

    const { userId, accountId } = req.account;
    const { orderId } = req.body;

    if (!orderId) {
      return res.status(400).json({
        status: "error",
        message: "orderId required",
      });
    }

    await verifyAccountOwnership(userId, accountId);

    tradeEngine.cancelPendingOrder({ accountId, orderId });

    return res.json({ status: "success" });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   ORDERS HISTORY (GET)
========================= */
export async function getOrdersController(req, res) {
  try {
    const { userId, accountId } = req.account;
    console.log("ACCOUNT ID IN GET ORDERS:", accountId);
    const {
      page = 1,
      limit = 20,
      symbol,
      symbols,
      filter,
      from,
      to,
      startDate,
      endDate,
    } = req.query;

    await verifyAccountOwnership(userId, accountId);

    const result = await getOrdersService({
      accountId,
      page: Number(page),
      limit: Number(limit),
      symbol,
      symbols,
      filter,
      from,
      to,
      startDate,
      endDate,
    });

    return res.json({ status: "success", ...result });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   DEALS HISTORY (GET)
========================= */
export async function getDealsController(req, res) {
  try {
    const { userId, accountId } = req.account;
    const {
      page = 1,
      limit = 20,
      symbol,
      symbols,
      filter,
      from,
      to,
      startDate,
      endDate,
    } = req.query;

    await verifyAccountOwnership(userId, accountId);

    const data = await getDealsService({
      accountId,
      page: Number(page),
      limit: Number(limit),
      symbol,
      symbols,
      filter,
      from,
      to,
      startDate,
      endDate,
    });

    return res.json({ status: "success", ...data });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   TRADE SUMMARY (GET)
========================= */
export async function getTradeSummaryController(req, res) {
  try {
    const { userId, accountId } = req.account;
    const { from, to } = req.query;

    await verifyAccountOwnership(userId, accountId);

    const summary = await getTradeSummaryService({ accountId, from, to });

    return res.json({ status: "success", summary });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   OPEN POSITIONS (GET)
========================= */
export async function getPositionsController(req, res) {
  try {
    const { userId, accountId } = req.account;
    const {
      page = 1,
      limit = 20,
      symbol,
      symbols,
      filter,
      from,
      to,
      startDate,
      endDate,
      status,
    } = req.query;

    await verifyAccountOwnership(userId, accountId);

    const result = await getPositionsService({
      accountId,
      page: Number(page),
      limit: Number(limit),
      symbol,
      symbols,
      filter,
      from,
      to,
      startDate,
      endDate,
      status,
    });

    return res.json({ status: "success", ...result });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message,
    });
  }
}

/* =========================
   GET SINGLE ACCOUNT
========================= */
export async function getSingleAccountController(req, res) {
  try {
    const { userId, accountId } = req.account;

    await verifyAccountOwnership(userId, accountId);

    const data = await getSingleAccountService(accountId);

    return res.json({
      status: "success",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message || "Failed to load account",
    });
  }
}

/* =========================
   USER PORTFOLIO SUMMARY (GET)
========================= */
export async function getUserPortfolioSummaryController(req, res) {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized",
      });
    }

    const data = await getUserPortfolioSummaryService(userId);

    return res.json({
      status: "success",
      data,
    });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message || "Failed to load portfolio summary",
    });
  }
}
