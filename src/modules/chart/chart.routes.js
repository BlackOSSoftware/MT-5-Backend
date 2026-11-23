import { Router } from "express";

import {
  getCandlesController,
  getManualPriceEventsController,
  getTimeframesController,
} from "./chart.controller.js";
import { accountAuthMiddleware } from "../../middlewares/accountAuth.middleware.js";

const router = Router();

// GET /api/v1/chart/timeframes
router.get("/timeframes", getTimeframesController);

// GET /api/v1/chart/candles?symbol=USDJPY&timeframe=M5&limit=300&before=<unixSec>
router.get("/candles", getCandlesController);

// GET /api/v1/chart/manual-price-events?symbol=XAUUSD (trade token)
router.get("/manual-price-events", accountAuthMiddleware, getManualPriceEventsController);

export default router;
