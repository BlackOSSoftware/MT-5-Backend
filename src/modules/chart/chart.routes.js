import { Router } from "express";

import {
  getCandlesController,
  getManualPriceEventsController,
  getTimeframesController,
} from "./chart.controller.js";
import {
  deleteDrawingByIdController,
  deleteDrawingsController,
  getDrawingsController,
  postDrawingController,
  putDrawingByIdController,
  putDrawingsController,
} from "./drawing.controller.js";
import { accountAuthMiddleware } from "../../middlewares/accountAuth.middleware.js";

const router = Router();

// GET /api/v1/chart/timeframes
router.get("/timeframes", getTimeframesController);

// GET /api/v1/chart/candles?symbol=USDJPY&timeframe=M5&limit=300&before=<unixSec>
router.get("/candles", getCandlesController);

// GET /api/v1/chart/manual-price-events?symbol=XAUUSD (trade token)
router.get("/manual-price-events", accountAuthMiddleware, getManualPriceEventsController);

// Chart drawings (trade token) — scoped by user + account + symbol + timeframe
router.get("/drawings", accountAuthMiddleware, getDrawingsController);
router.put("/drawings", accountAuthMiddleware, putDrawingsController);
router.post("/drawings", accountAuthMiddleware, postDrawingController);
router.delete("/drawings", accountAuthMiddleware, deleteDrawingsController);
router.put("/drawings/:id", accountAuthMiddleware, putDrawingByIdController);
router.delete("/drawings/:id", accountAuthMiddleware, deleteDrawingByIdController);

export default router;
