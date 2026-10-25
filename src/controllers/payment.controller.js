import {
  createPaymentMethodService,
  updatePaymentMethodService,
  deletePaymentMethodService,
  togglePaymentMethodService,
  getActivePaymentMethodsService,
  getAllPaymentMethodsService
} from '../services/payment.service.js';

/**
 * CREATE (ADMIN)
 */
export async function createPaymentMethod(req, res) {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required'
      });
    }

    const data = await createPaymentMethodService(
      req.user._id,
      req.body,
      req.brokerId || null,
    );

    return res.status(201).json({
      success: true,
      data
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to create payment method'
    });
  }
}

/**
 * UPDATE (ADMIN)
 */
export async function updatePaymentMethod(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Payment method id is required'
      });
    }

    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Request body is required'
      });
    }

    const data = await updatePaymentMethodService(
      id,
      req.body,
      req.brokerId || null,
    );

    return res.json({
      success: true,
      data
    });

  } catch (err) {
    if (err.code === 'INVALID_ID') {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: err.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update payment method'
    });
  }
}

/**
 * DELETE (ADMIN)
 */
export async function deletePaymentMethod(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Payment method id is required'
      });
    }

    await deletePaymentMethodService(id, req.brokerId || null);

    return res.status(200).json({
      success: true,
      message: 'Deleted successfully'
    });

  } catch (err) {
    if (err.code === 'INVALID_ID') {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: err.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to delete payment method'
    });
  }
}

/**
 * ACTIVE / INACTIVE (ADMIN)
 */
export async function togglePaymentMethod(req, res) {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Payment method id is required'
      });
    }

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'is_active (boolean) is required'
      });
    }

    const updated = await togglePaymentMethodService(
      id,
      is_active,
      req.brokerId || null,
    );

    return res.status(200).json({
      success: true,
      message: is_active
        ? 'Payment method activated'
        : 'Payment method deactivated',
      data: {
        id: updated._id,
        is_active: updated.is_active
      }
    });

  } catch (err) {
    if (err.code === 'INVALID_ID') {
      return res.status(400).json({
        success: false,
        message: err.message
      });
    }

    if (err.code === 'NOT_FOUND') {
      return res.status(404).json({
        success: false,
        message: err.message
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Failed to update payment method status'
    });
  }
}

/**
 * GET ALL METHODS (ADMIN)
 */
export async function getAllPaymentMethods(req, res) {
  try {
    const data = await getAllPaymentMethodsService(req.brokerId || null);

    return res.json({
      success: true,
      data
    });

  } catch {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment methods'
    });
  }
}

/**
 * GET ACTIVE METHODS (USER)
 */
export async function getActivePaymentMethods(req, res) {
  try {
    const payload = await getActivePaymentMethodsService(
      req.user?.brokerId || null,
    );

    return res
      .type('json')
      .send(
        JSON.stringify({
          success: true,
          data: JSON.parse(payload)
        })
      );
  } catch {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch active payment methods'
    });
  }
}
