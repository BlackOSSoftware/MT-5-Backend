import { Router } from 'express';

import { adminAuth } from '../../middlewares/adminAuth.middleware.js';
import {
  getAllMarketStatuses,
  getMarketSchedule,
  getMarketStatistics,
  getMarketStatus,
  updateMarketSchedule,
} from '../../controllers/market.controller.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';

const router = Router();

// admin schedule manage
router.get('/schedule/:segment', authMiddleware,adminAuth, getMarketSchedule);
router.put('/schedule/:segment', authMiddleware,adminAuth, updateMarketSchedule);

// public status + statistics (Alltick OHLC)
router.get('/statuses', getAllMarketStatuses);
router.get('/statistics/:symbol', getMarketStatistics);
router.get('/status/:segment', getMarketStatus);

export default router;
