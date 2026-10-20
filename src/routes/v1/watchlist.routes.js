import { Router } from 'express';
import {
  addToWatchlist,
  reorderWatchlist,
  getWatchlist,
  getWatchlistItem,
  removeFromWatchlist,
  getDefaultWatchlist,
  addDefaultWatchlistItem,
  removeDefaultWatchlistItem,
  getSegmentInstrumentsWithWatchlistStatus,
  getSegments,
  searchInstrumentsWithWatchlistStatus,
} from '../../controllers/watchlist.controller.js';

import { accountAuthMiddleware } from '../../middlewares/accountAuth.middleware.js';
import { authMiddleware } from '../../middlewares/auth.middleware.js';
import { adminAuth } from '../../middlewares/adminAuth.middleware.js';

const router = Router();

// user watchlist (ACCOUNT TOKEN)
router.get('/', accountAuthMiddleware, getWatchlist);
router.get('/segments', accountAuthMiddleware, getSegments);
router.get('/:code', accountAuthMiddleware, getWatchlistItem);
router.post('/add', accountAuthMiddleware, addToWatchlist);
router.put('/reorder', accountAuthMiddleware, reorderWatchlist);
router.delete('/remove/:code', accountAuthMiddleware, removeFromWatchlist);
router.get('/segment/:segment', accountAuthMiddleware, getSegmentInstrumentsWithWatchlistStatus);
router.get('/search/instruments', accountAuthMiddleware, searchInstrumentsWithWatchlistStatus);

// default watchlist (ADMIN - UNTOUCHED)
router.get('/default/list', authMiddleware, getDefaultWatchlist);
router.post('/default/add', authMiddleware, adminAuth, addDefaultWatchlistItem);
router.delete('/default/remove/:code', authMiddleware, adminAuth, removeDefaultWatchlistItem);

export default router;
