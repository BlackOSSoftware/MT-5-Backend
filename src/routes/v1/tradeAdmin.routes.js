import { Router } from "express";

// Import all admin trade controllers
import {
  adminBulkCreatePositionHistory,
  adminCancelPendingOrder,
  adminClosePosition,
  adminListBrokerage,
  adminListClosedTrades,
  adminListOpenTrades,
  adminListPendingOrdersHistory,
  adminListPendingOrdersOpen,
  adminListUsersFunds,
  adminDeleteTrade,
  adminListDeletedTrades,
  adminModifyClosedTrade,
  adminModifyPendingOrder,
  adminModifyPosition,
  adminPlaceMarketOrder,
  adminPlacePendingOrder,
  adminRestoreTrade,
  getTradeAdminSummary,
} from "../../controllers/tradeAdmin.controller.js";

// Import middlewares
import { brokerAdminAuth } from "../../middlewares/brokerAuth.middleware.js";

// Create router instance
const router = Router();

/* ============================
   ADMIN DASHBOARD & REPORTS
============================ */

// Get overall trading summary
// GET /api/v1/trade-admin/summary
router.get("/summary", brokerAdminAuth, getTradeAdminSummary);

// Get brokerage earnings
// GET /api/v1/trade-admin/brokerage
router.get("/brokerage", brokerAdminAuth, adminListBrokerage);

// Get all users funds
// GET /api/v1/trade-admin/users/funds
router.get("/users/funds", brokerAdminAuth, adminListUsersFunds);

// Get all open trades
// GET /api/v1/trade-admin/trades/open
router.get("/trades/open", brokerAdminAuth, adminListOpenTrades);

// Get all closed trades
// GET /api/v1/trade-admin/trades/closed
router.get("/trades/closed", brokerAdminAuth, adminListClosedTrades);

// Get currently open pending orders
// GET /api/v1/trade-admin/orders/pending/open
router.get("/orders/pending/open", brokerAdminAuth, adminListPendingOrdersOpen);

// Get pending orders history
// GET /api/v1/trade-admin/orders/pending/history
router.get("/orders/pending/history", brokerAdminAuth, adminListPendingOrdersHistory);

/* ============================
   BACKWARD COMPATIBLE ROUTES
============================ */

// Old route for open trades
router.get("/trade/open", brokerAdminAuth, adminListOpenTrades);

// Old route for closed trades
router.get("/trade/closed", brokerAdminAuth, adminListClosedTrades);

// Old route for open pending orders
router.get("/trade/pending/open", brokerAdminAuth, adminListPendingOrdersOpen);

// Old route for pending history
router.get("/trade/pending/history", brokerAdminAuth, adminListPendingOrdersHistory);

/* ============================
   ADMIN: TRADE MANAGEMENT
============================ */

// Place market order for user
// POST /api/v1/trade-admin/trade/market
router.post("/trade/market", brokerAdminAuth, adminPlaceMarketOrder);

// Place pending order for user
// POST /api/v1/trade-admin/trade/pending
router.post("/trade/pending", brokerAdminAuth, adminPlacePendingOrder);

// Modify existing pending order
// PATCH /api/v1/trade-admin/trade/pending/modify
router.patch("/trade/pending/modify", brokerAdminAuth, adminModifyPendingOrder);

// Cancel pending order
// POST /api/v1/trade-admin/trade/pending/cancel
router.post("/trade/pending/cancel", brokerAdminAuth, adminCancelPendingOrder);

// Modify open position
// PATCH /api/v1/trade-admin/trade/position/modify
router.patch("/trade/position/modify", brokerAdminAuth, adminModifyPosition);

// Modify closed trade (history overwrite + balance delta)
// PATCH /api/v1/trade-admin/trade/closed/modify
router.patch("/trade/closed/modify", brokerAdminAuth, adminModifyClosedTrade);

// Soft-delete live / pending / closed trade (PnL adjust for closed)
// POST /api/v1/trade-admin/trade/delete
router.post("/trade/delete", brokerAdminAuth, adminDeleteTrade);

// Restore soft-deleted trade
// POST /api/v1/trade-admin/trade/restore
router.post("/trade/restore", brokerAdminAuth, adminRestoreTrade);

// List soft-deleted trades
// GET /api/v1/trade-admin/trades/deleted
router.get("/trades/deleted", brokerAdminAuth, adminListDeletedTrades);

// Close open position
// POST /api/v1/trade-admin/trade/position/close
router.post("/trade/position/close", brokerAdminAuth, adminClosePosition);
router.post("/history/positions/bulk", brokerAdminAuth, adminBulkCreatePositionHistory);

// Export router
export default router;
