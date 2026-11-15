import { createInstrumentService, deleteInstrumentService, getAllInstrumentService, searchInstrumentService, updateInstrumentService } from '../services/instrument.service.js';
import {
  ACTIVITY_ACTIONS,
  logAdminAction,
} from '../services/activity.service.js';

const instIp = (req) =>
  req.ip || req.headers?.['x-forwarded-for'] || null;

const instActor = (req) => req.user?._id || req.user?.id || null;

export const createInstrument = async (req, res) => {
  try {
    const instrument = await createInstrumentService(req.body);
    logAdminAction({
      actorId: instActor(req),
      action: ACTIVITY_ACTIONS.INSTRUMENT_CREATED,
      ip: instIp(req),
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: 'Instrument created successfully',
      data: instrument
    });
  } catch (error) {
    const msg = String(error?.message || "");
    const isDuplicate =
      error?.code === 11000 ||
      msg.toLowerCase().includes("already exists");

    if (isDuplicate) {
      return res.status(409).json({
        success: false,
        message: "This symbol is already added"
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

export async function getInstrument(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.max(parseInt(req.query.limit) || 10, 1);
    const segment = req.query.segment || 'ALL';

    const { data, total } = await getAllInstrumentService(
      page,
      limit,
      segment
    );

    res.json({
      success: true,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export async function searchInstrument(req, res) {
  try {
    const q = req.query.q;
    const segment = req.query.segment || "ALL";
    const limit = req.query.limit || 20;

    const data = await searchInstrumentService(q, segment, limit);

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
}

export const updateInstrument = async (req, res) => {
  try {
    const { id } = req.params;

    const instrument = await updateInstrumentService(id, req.body);
    logAdminAction({
      actorId: instActor(req),
      action: ACTIVITY_ACTIONS.INSTRUMENT_UPDATED,
      ip: instIp(req),
    }).catch(() => {});

    return res.json({
      success: true,
      message: 'Instrument updated successfully',
      data: instrument
    });
  } catch (error) {
    const msg = String(error?.message || "");
    const isDuplicate =
      error?.code === 11000 ||
      msg.toLowerCase().includes("already exists");

    if (isDuplicate) {
      return res.status(409).json({
        success: false,
        message: "This symbol is already added"
      });
    }

    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
};

export const deleteInstrument = async (req, res) => {
  try {
    const { id } = req.params;

    const instrument = await deleteInstrumentService(id);
    logAdminAction({
      actorId: instActor(req),
      action: ACTIVITY_ACTIONS.INSTRUMENT_DELETED,
      ip: instIp(req),
    }).catch(() => {});

    return res.json({
      success: true,
      message: 'Instrument deleted successfully',
      data: instrument
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
};
