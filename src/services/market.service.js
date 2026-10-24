import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { MarketSchedule } from '../models/MarketSchedule.model.js';
import redis, { isRedisReady } from '../config/redis.js';
import { REDIS_MARKET_SCHEDULE_KEY, REDIS_MARKET_STATUS_KEY } from '../config/market.redis.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const normalizeSegment = (segment) => {
  const seg = String(segment || '').trim().toLowerCase();
  // Admin UI "indexes" + instrument "indices" / "index" → ek hi schedule doc
  if (seg === 'indexes' || seg === 'index') return 'indices';
  return seg;
};
const normalizeDay = (dayName) => String(dayName || '').trim().toUpperCase();

// We keep market status in Redis with a short TTL so it auto-refreshes with time.
// Cron refreshes it every minute; TTL slightly higher avoids gaps.
const MARKET_STATUS_TTL_SECONDS = 70;

const isValidHHMM = (t) => {
  const raw = String(t || '').trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(raw);
};

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map((v) => Number(v));
  return h * 60 + m;
};

const getNowInTimeZone = (timeZone) => {
  if (!timeZone) return dayjs();
  try {
    return dayjs().tz(timeZone);
  } catch {
    // If an invalid IANA timezone string is provided, fallback to server time
    return dayjs();
  }
};

const getTodayYYYYMMDD = (timeZone) => getNowInTimeZone(timeZone).format('YYYY-MM-DD');
const getTodayDayName = (timeZone) => getNowInTimeZone(timeZone).format('dddd').toUpperCase();

const resolveTodayTiming = (schedule) => {
  const tz = schedule?.timezone || 'Asia/Kolkata';
  const todayDate = getTodayYYYYMMDD(tz);
  const todayDay = getTodayDayName(tz);

  let openTime = schedule.openTime;
  let closeTime = schedule.closeTime;

  // 1) Day override example: SATURDAY close 14:30
  if (schedule.dayOverrides && schedule.dayOverrides[todayDay]) {
    const d = schedule.dayOverrides[todayDay];
    if (d.openTime && isValidHHMM(d.openTime)) openTime = d.openTime;
    if (d.closeTime && isValidHHMM(d.closeTime)) closeTime = d.closeTime;
  }

  // 2) Date override example: 2026-02-03 close 16:00 (highest priority)
  if (schedule.dateOverrides && schedule.dateOverrides[todayDate]) {
    const x = schedule.dateOverrides[todayDate];
    if (x.openTime && isValidHHMM(x.openTime)) openTime = x.openTime;
    if (x.closeTime && isValidHHMM(x.closeTime)) closeTime = x.closeTime;
  }

  return { openTime, closeTime, todayDate, todayDay };
};

const computeMarketState = (schedule) => {
  const { openTime, closeTime, todayDate, todayDay } = resolveTodayTiming(schedule);
  const tz = schedule?.timezone || 'Asia/Kolkata';
  const now = getNowInTimeZone(tz);

  const openMin = toMinutes(openTime);
  const closeMin = toMinutes(closeTime);
  const nowMin = now.hour() * 60 + now.minute();

  const sessionType =
    openMin === closeMin ? 'OPEN_24H' : openMin < closeMin ? 'NORMAL' : 'OVERNIGHT';

  const debug = {
    todayDate,
    todayDay,
    timeZone: tz,
    nowLocal: now.format('YYYY-MM-DD HH:mm:ss'),
    nowMin,
    openMin,
    closeMin,
    sessionType,
  };

  if (!schedule.isEnabled) {
    return { isMarketOpen: false, reason: 'DISABLED', openTime, closeTime, debug };
  }

  if (Array.isArray(schedule.holidays) && schedule.holidays.includes(todayDate)) {
    return { isMarketOpen: false, reason: 'HOLIDAY', openTime, closeTime, debug };
  }

  if (Array.isArray(schedule.weeklyOff) && schedule.weeklyOff.includes(todayDay)) {
    return { isMarketOpen: false, reason: 'WEEKLY_OFF', openTime, closeTime, debug };
  }

  // Support sessions that cross midnight.
  // Examples:
  // - Normal: 09:15 -> 15:30 (openMin < closeMin)
  // - Overnight: 09:15 -> 00:15 (openMin > closeMin)
  // - 24h: 00:00 -> 00:00 (openMin === closeMin)
  let isOpen;
  if (openMin === closeMin) {
    isOpen = true; // treat as 24h session
  } else if (openMin < closeMin) {
    isOpen = nowMin >= openMin && nowMin <= closeMin;
  } else {
    // crosses midnight: open from openMin..23:59 OR 00:00..closeMin
    isOpen = nowMin >= openMin || nowMin <= closeMin;
  }

  return {
    isMarketOpen: isOpen,
    reason: isOpen ? (openMin === closeMin ? 'OPEN_24H' : 'OPEN_TIME_WINDOW') : 'OUTSIDE_HOURS',
    openTime,
    closeTime,
    debug,
  };
};

const redisGetSafe = async (key) => {
  try {
    if (!isRedisReady()) return null;
    return await redis.get(key);
  } catch (err) {
    console.error('Redis GET failed:', key, err?.message || err);
    return null;
  }
};

const redisSetSafe = async (key, value) => {
  try {
    if (!isRedisReady()) return false;
    await redis.set(key, value);
    return true;
  } catch (err) {
    console.error('Redis SET failed:', key, err?.message || err);
    return false;
  }
};

const redisSetSafeWithTtl = async (key, value, ttlSeconds) => {
  const ttl = Number(ttlSeconds);

  // If TTL is not valid, fallback to normal SET (no TTL).
  if (!Number.isFinite(ttl) || ttl <= 0) {
    return redisSetSafe(key, value);
  }

  try {
    if (!isRedisReady()) return false;
    await redis.set(key, value, 'EX', ttl);
    return true;
  } catch (err) {
    console.error('Redis SETEX failed:', key, err?.message || err);
    return false;
  }
};

export const marketService = {
  async ensureDefaultSchedule(segment) {
    const seg = normalizeSegment(segment);
    if (!seg) return null;

    const existing = await MarketSchedule.findOne({ segment: seg }).lean();
    if (existing) return existing;

    const created = await MarketSchedule.create({
      segment: seg,
      timezone: 'Asia/Kolkata',
      openTime: '09:15',
      closeTime: '15:30',
      weeklyOff: ['SUNDAY'],
      holidays: [],
      dayOverrides: {
        SATURDAY: { closeTime: '14:30' },
      },
      dateOverrides: {},
      isEnabled: true,
    });

    return created.toObject();
  },

  async getSchedule(segment) {
    const seg = normalizeSegment(segment);
    if (!seg) return { error: { status: 400, message: 'segment is required' } };

    // 1) Redis cache
    const cached = await redisGetSafe(REDIS_MARKET_SCHEDULE_KEY(seg));
    if (cached) {
      return { data: JSON.parse(cached) };
    }

    // 2) DB fallback
    const schedule = await this.ensureDefaultSchedule(seg);
    if (!schedule) return { error: { status: 404, message: 'schedule not found' } };

    // 3) cache back
    await redisSetSafe(REDIS_MARKET_SCHEDULE_KEY(seg), JSON.stringify(schedule));

    return { data: schedule };
  },

  async updateSchedule(segment, payload) {
    const seg = normalizeSegment(segment);
    if (!seg) return { error: { status: 400, message: 'segment is required' } };

    const openTime = payload?.openTime;
    const closeTime = payload?.closeTime;

    if (!isValidHHMM(openTime)) {
      return { error: { status: 400, message: 'Invalid openTime (HH:mm)' } };
    }
    if (!isValidHHMM(closeTime)) {
      return { error: { status: 400, message: 'Invalid closeTime (HH:mm)' } };
    }

    const weeklyOff = Array.isArray(payload?.weeklyOff)
      ? payload.weeklyOff.map(normalizeDay)
      : ['SUNDAY'];

    const holidays = Array.isArray(payload?.holidays)
      ? payload.holidays.map((d) => String(d).trim())
      : [];

    const timezone = payload?.timezone ? String(payload.timezone).trim() : 'Asia/Kolkata';
    const isEnabled = typeof payload?.isEnabled === 'boolean' ? payload.isEnabled : true;

    const dayOverrides =
      payload?.dayOverrides && typeof payload.dayOverrides === 'object' ? payload.dayOverrides : {};

    const dateOverrides =
      payload?.dateOverrides && typeof payload.dateOverrides === 'object' ? payload.dateOverrides : {};

    const updated = await MarketSchedule.findOneAndUpdate(
      { segment: seg },
      {
        $set: {
          segment: seg,
          openTime: String(openTime),
          closeTime: String(closeTime),
          weeklyOff,
          holidays,
          timezone,
          isEnabled,
          dayOverrides,
          dateOverrides,
        },
      },
      { new: true, upsert: true }
    ).lean();

    // Schedule cache
    await redisSetSafe(REDIS_MARKET_SCHEDULE_KEY(seg), JSON.stringify(updated));

    // Status cache update instantly
    const computed = computeMarketState(updated);
    const status = {
      segment: seg,
      isMarketOpen: computed.isMarketOpen,
      reason: computed.reason,
      openTime: computed.openTime,
      closeTime: computed.closeTime,
      timezone: updated.timezone,
      lastCheckedAt: new Date().toISOString(),
    };

    await redisSetSafeWithTtl(
      REDIS_MARKET_STATUS_KEY(seg),
      JSON.stringify(status),
      MARKET_STATUS_TTL_SECONDS
    );

    return { data: updated };
  },

  // Force recompute status (ignores Redis status cache). Use for cron refresh.
  async refreshMarketStatus(segment, { debug = false } = {}) {
    const seg = normalizeSegment(segment);
    if (!seg) return { error: { status: 400, message: 'segment is required' } };

    const scheduleRes = await this.getSchedule(seg);
    if (scheduleRes.error) return scheduleRes;

    const schedule = scheduleRes.data;
    const computed = computeMarketState(schedule);

    const status = {
      segment: seg,
      isMarketOpen: computed.isMarketOpen,
      reason: computed.reason,
      openTime: computed.openTime,
      closeTime: computed.closeTime,
      timezone: schedule.timezone,
      lastCheckedAt: new Date().toISOString(),
    };

    const cacheStatus = { ...status };

    if (debug) {
      status.debug = computed.debug;
    }

    await redisSetSafeWithTtl(
      REDIS_MARKET_STATUS_KEY(seg),
      JSON.stringify(cacheStatus),
      MARKET_STATUS_TTL_SECONDS
    );

    return { data: status };
  },

  async getMarketStatus(segment) {
    const seg = normalizeSegment(segment);
    if (!seg) return { error: { status: 400, message: 'segment is required' } };

    // 1) Redis cache
    const cachedStatus = await redisGetSafe(REDIS_MARKET_STATUS_KEY(seg));
    if (cachedStatus) {
      return { data: JSON.parse(cachedStatus) };
    }

    // 2) cache miss -> recompute and set a fresh TTL
    return await this.refreshMarketStatus(seg);
  },

  async getMarketStatusBySegments(segments) {
    const uniqueSegments = Array.isArray(segments)
      ? Array.from(new Set(segments.map(normalizeSegment).filter(Boolean)))
      : [];

    const marketBySegment = {};

    for (const seg of uniqueSegments) {
      const res = await this.getMarketStatus(seg);
      if (res.data) marketBySegment[seg] = res.data;
    }

    return { data: marketBySegment };
  },

  // Optional debug function
  async debugRedis() {
    return {
      isReady: isRedisReady(),
      status: typeof redis.status === 'string' ? redis.status : 'unknown',
    };
  },
};
