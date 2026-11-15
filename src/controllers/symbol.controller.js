import { bulkInsertSymbolsService, getSymbolsService } from '../services/symbol.service.js';
import {
  ACTIVITY_ACTIONS,
  logAdminAction,
} from '../services/activity.service.js';

export async function getSymbols(req, res) {
  try {
    const {
      page = 1,
      limit = 50,
      category,
      isActive,
      search,
      q,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Validate and sanitize inputs
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const isActiveBool = isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    const sortOrderStr = sortOrder === 'asc' ? 'asc' : 'desc';
    const allowedSortFields = ['name', 'code', 'category', 'createdAt', 'updatedAt'];
    const sortByStr = allowedSortFields.includes(sortBy) ? sortBy : 'createdAt';

    const searchQuery = search ?? q;

    const result = await getSymbolsService({
      page: pageNum,
      limit: limitNum,
      category,
      isActive: isActiveBool,
      search: searchQuery,
      sortBy: sortByStr,
      sortOrder: sortOrderStr
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

export async function bulkAddSymbols(req, res) {
  try {
    const { symbols } = req.body;

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'symbols array is required'
      });
    }

    const result = await bulkInsertSymbolsService(symbols);
    logAdminAction({
      actorId: req.user?._id || req.user?.id || null,
      action: ACTIVITY_ACTIONS.SYMBOLS_BULK_ADDED,
      ip: req.ip || req.headers?.['x-forwarded-for'] || null,
      userAgent: req.headers?.['user-agent'] || null,
      description: `Bulk added ${symbols.length} symbol(s)`,
      targetEntityType: 'symbol',
      metadata: { count: symbols.length },
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message
    });
  }
}
