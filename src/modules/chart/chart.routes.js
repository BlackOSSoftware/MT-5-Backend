import { Router } from "express";

import {
  getCandlesController,
  getTimeframesController,
} from "./chart.controller.js";

const router = Router();

// GET /api/v1/chart/timeframes
router.get("/timeframes", getTimeframesController);

// GET /api/v1/chart/candles?symbol=USDJPY&timeframe=M5&limit=300&before=<unixSec>
router.get("/candles", getCandlesController);

export default router;
