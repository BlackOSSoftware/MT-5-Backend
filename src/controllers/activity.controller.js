import {
  getAllActivityService,
  getUserActivityService
} from '../services/activity.service.js';

export async function getMyActivity(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const limit = Number(req.query.limit) || 20;
    const before = req.query.before || null;

    const result = await getUserActivityService({
      userId,
      limit,
      before
    });

    return res.json({
      success: true,
      data: result.items,
      nextCursor: result.nextCursor,
      limit: result.limit
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function adminGetUserActivity(req, res) {
  try {
    const { userId } = req.params;
    if (req.brokerId) {
      const { assertUserBelongsToBroker } = await import("../utils/brokerScope.js");
      await assertUserBelongsToBroker(userId, req.brokerId);
    }
    const limit = Number(req.query.limit) || 20;
    const before = req.query.before || null;
    const includeUser = true;

    const result = await getUserActivityService({
      userId,
      limit,
      before,
      includeUser
    });

    return res.json({
      success: true,
      data: result.items,
      nextCursor: result.nextCursor,
      limit: result.limit
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export async function adminListActivity(req, res) {
  try {
    const limit = Number(req.query.limit) || 20;
    const before = req.query.before || null;
    const action = req.query.action || null;
    const userId = req.query.userId || null;
    const actorType = req.query.actorType || null;
    const includeUser = true;

    const result = await getAllActivityService({
      limit,
      before,
      action,
      userId,
      actorType,
      includeUser,
      brokerId: req.brokerId || null,
    });

    return res.json({
      success: true,
      data: result.items,
      nextCursor: result.nextCursor,
      limit: result.limit
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}
