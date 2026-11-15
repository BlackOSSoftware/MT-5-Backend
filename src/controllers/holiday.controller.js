import {
  createHolidayService,
  getAllHolidaysService,
  getHolidayByIdService,
  updateHolidayService,
  deleteHolidayService
} from '../services/holiday.service.js';
import {
  ACTIVITY_ACTIONS,
  logAdminAction,
} from '../services/activity.service.js';

const holidayIp = (req) =>
  req.ip || req.headers?.['x-forwarded-for'] || null;

const holidayActor = (req) => req.user?._id || req.user?.id || null;

export async function createHoliday(req, res) {
  try {
    const { title, date, isActive } = req.body;

    const holidayDate = new Date(date);

    const expireAt = new Date(holidayDate);
    expireAt.setDate(expireAt.getDate() + 1);

    const holiday = await createHolidayService({
      title,
      date: holidayDate,
      isActive: typeof isActive === 'boolean' ? isActive : true,
      expireAt
    });

    logAdminAction({
      actorId: holidayActor(req),
      action: ACTIVITY_ACTIONS.HOLIDAY_CREATED,
      ip: holidayIp(req),
    }).catch(() => {});

    res.status(201).json({ success: true, data: holiday });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function getHolidays(req, res) {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;

    const { data, total } = await getAllHolidaysService(page, limit);

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


export async function getHolidayById(req, res) {
  try {
    const holiday = await getHolidayByIdService(req.params.id);
    if (!holiday) {
      return res.status(404).json({ success: false, message: 'Holiday not found' });
    }
    res.json({ success: true, data: holiday });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function updateHoliday(req, res) {
  try {
    const holiday = await updateHolidayService(req.params.id, req.body);
    logAdminAction({
      actorId: holidayActor(req),
      action: ACTIVITY_ACTIONS.HOLIDAY_UPDATED,
      ip: holidayIp(req),
    }).catch(() => {});
    res.json({ success: true, data: holiday });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function deleteHoliday(req, res) {
  try {
    await deleteHolidayService(req.params.id);
    logAdminAction({
      actorId: holidayActor(req),
      action: ACTIVITY_ACTIONS.HOLIDAY_DELETED,
      ip: holidayIp(req),
    }).catch(() => {});
    res.json({ success: true, message: 'Holiday deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
