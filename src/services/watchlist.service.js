import WatchlistItem from "../models/watchlistItem.model.js";
import redisClient from "../config/redis.js";
import InstrumentModel from "../models/Instrument.model.js";
import DefaultWatchlistItem from "../models/defaultWatchlistItem.model.js";

const REDIS_DEFAULT_KEY = "default:watchlist:v1";

//  account-wise cache
const REDIS_ACCOUNT_KEY = (accountId) =>
  `account:watchlist:v1:${String(accountId)}`;

const normalizeCode = (value) =>
  String(value || "")
    .trim()
    .toUpperCase();

const normalizeName = (value) => String(value || "").trim();

const parseLimit = (value) => {
  const limitRaw = Number(value || 50);
  return Math.min(Math.max(limitRaw, 1), 200);
};

const normalizeAccountId = (value) => {
  const accountId = String(value || "").trim();
  return accountId || "";
};

const isRedisReady = () => {
  try {
    if (!redisClient) return false;

    //  ioredis uses status
    return (
      typeof redisClient.status === "string" && redisClient.status === "ready"
    );
  } catch (error) {
    return false;
  }
};

const getRedisJSON = async (key) => {
  if (!isRedisReady()) {
    return null;
  }

  try {
    const raw = await redisClient.get(key);

    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      return parsed;
    } catch (error) {
      return null;
    }
  } catch (error) {
    return null;
  }
};

const setRedisJSON = async (key, value, ttlSeconds) => {
  if (!isRedisReady()) {
    return false;
  }

  try {
    const payload = JSON.stringify(value);

    if (typeof ttlSeconds === "number" && ttlSeconds > 0) {
      //  ioredis TTL set
      await redisClient.set(key, payload, "EX", ttlSeconds);
      return true;
    }

    await redisClient.set(key, payload);
    return true;
  } catch (error) {
    return false;
  }
};

const delRedis = async (key) => {
  if (!isRedisReady()) {
    return false;
  }

  try {
    await redisClient.del(key);
    return true;
  } catch (error) {
    return false;
  }
};

export const watchlistService = {
  parseLimit,
  normalizeCode,
  normalizeName,

  // -------------------------
  // DEFAULT WATCHLIST (DB + REDIS CACHE)
  // -------------------------

  async getDefaultList() {

    //  Fast return from Redis
    const cached = await getRedisJSON(REDIS_DEFAULT_KEY);

    if (Array.isArray(cached)) {

      return cached
        .filter((x) => x && typeof x === "object")
        .map((x) => ({
          code: normalizeCode(x.code),
          name: normalizeName(x.name),
        }))
        .filter((x) => x.code && x.name);
    }


    // Cache miss => fetch from DB
    const list = await DefaultWatchlistItem.find({})
      .sort({ createdAt: -1, _id: -1 })
      .select("code name");


    if (!Array.isArray(list) || list.length === 0) {
      const savedEmpty = await setRedisJSON(REDIS_DEFAULT_KEY, [], 300);
      return [];
    }

    const codes = list.map((x) => normalizeCode(x.code)).filter(Boolean);

    //  return only active instruments
    const instruments = await InstrumentModel.find({
      code: { $in: codes },
      isActive: true,
    }).select("code name");

    if (!Array.isArray(instruments) || instruments.length === 0) {
      const savedEmpty = await setRedisJSON(REDIS_DEFAULT_KEY, [], 300);
      return [];
    }

    const activeMap = new Map(
      instruments.map((i) => [normalizeCode(i.code), normalizeName(i.name)])
    );

    const finalList = list
      .map((x) => {
        const code = normalizeCode(x.code);
        const name = activeMap.get(code);
        if (!code || !name) return null;
        return { code, name };
      })
      .filter((x) => x && x.code && x.name);


    //  cache for fast next request
    const saved = await setRedisJSON(REDIS_DEFAULT_KEY, finalList, 300);

    //  verify cache write
    const verify = await getRedisJSON(REDIS_DEFAULT_KEY);
    return finalList;
  },

  async addDefaultItem(payload) {
    const code = normalizeCode(payload?.code);

    if (!code) return { error: { status: 400, message: "Code is required" } };
    if (code.length > 30)
      return { error: { status: 400, message: "Code is too long" } };

    const instrument = await InstrumentModel.findOne({ code }).select(
      "code name isActive"
    );

    if (!instrument) {
      return { error: { status: 404, message: "Instrument not found" } };
    }

    if (instrument.isActive !== true) {
      return { error: { status: 400, message: "Instrument is not active" } };
    }

    const name = normalizeName(instrument.name);

    if (!name) return { error: { status: 400, message: "Name is required" } };
    if (name.length > 60)
      return { error: { status: 400, message: "Name is too long" } };

    const existing = await DefaultWatchlistItem.findOne({ code }).select(
      "_id code name"
    );

    if (existing) {
      if (existing.name !== name) {
        existing.name = name;
        await existing.save();

        await delRedis(REDIS_DEFAULT_KEY);

        const updatedList = await this.getDefaultList();
        return {
          data: updatedList,
          message: "Default item updated",
          alreadyExists: true,
        };
      }

      return {
        error: {
          status: 409,
          message: "This instrument is already added in default watchlist",
        },
      };
    }

    await DefaultWatchlistItem.create({ code, name });

    await delRedis(REDIS_DEFAULT_KEY);

    const updatedList = await this.getDefaultList();

    return { data: updatedList, message: "Default item added" };
  },

  async removeDefaultItem(codeRaw) {
    const code = normalizeCode(codeRaw);
    if (!code) return { error: { status: 400, message: "Code is required" } };

    const removed = await DefaultWatchlistItem.findOneAndDelete({ code }).select(
      "_id code name"
    );

    if (!removed) {
      return { error: { status: 404, message: "Default item not found" } };
    }

    await delRedis(REDIS_DEFAULT_KEY);

    const updatedList = await this.getDefaultList();

    return { data: updatedList, message: "Default item removed" };
  },

  // -------------------------
  // ACCOUNT DEFAULT SEEDING
  // -------------------------

  async ensureDefaultForAccount(userId, accountIdRaw) {
    const accountId = normalizeAccountId(accountIdRaw);

    if (!accountId) {
      return { error: { status: 400, message: "AccountId is required" } };
    }

    const total = await WatchlistItem.countDocuments({
      userId,
      accountId,
      isAdded: true,
    });

    if (total > 0) return { data: null, message: "Account watchlist already exists" };

    const defaultList = await this.getDefaultList();
    if (defaultList.length === 0) return { data: null, message: "Default watchlist is empty" };

    const ops = defaultList.map((item) => ({
      updateOne: {
        filter: { userId, accountId, code: item.code },
        update: {
          $setOnInsert: {
            userId,
            accountId,
            code: item.code,
            name: item.name,
            isAdded: true,
          },
        },
        upsert: true,
      },
    }));

    await WatchlistItem.bulkWrite(ops, { ordered: false });

    await delRedis(REDIS_ACCOUNT_KEY(accountId));

    return { data: null, message: "Default watchlist seeded for account" };
  },

  // -------------------------
  // ACCOUNT WATCHLIST (CACHE)
  // -------------------------

  async getAccountWatchlist(userId, accountIdRaw, limit) {
    const accountId = normalizeAccountId(accountIdRaw);

    if (!accountId) {
      return { error: { status: 400, message: "AccountId is required" } };
    }

    const cached = await getRedisJSON(REDIS_ACCOUNT_KEY(accountId));
    if (Array.isArray(cached)) {
      return { data: cached.slice(0, limit), message: "Watchlist fetched (cache)" };
    }

    const items = await WatchlistItem.find({
      userId,
      accountId,
      isAdded: true,
    })
      .sort({ sort_order: 1, createdAt: -1, _id: -1 })
      .limit(limit)
      .select(
        "_id code name isAdded sort_order accountId userId createdAt updatedAt"
      );

    await setRedisJSON(REDIS_ACCOUNT_KEY(accountId), items, 30);

    return { data: items, message: "Watchlist fetched" };
  },

  // Drag karke badli hui watchlist order ko save karo:
  // codes jis order me aaye, wahi sort_order (0,1,2...) banega.
  async reorderAccountWatchlist(userId, accountIdRaw, codesRaw) {
    const accountId = normalizeAccountId(accountIdRaw);
    if (!accountId) {
      return { error: { status: 400, message: "AccountId is required" } };
    }
    if (!Array.isArray(codesRaw) || codesRaw.length === 0) {
      return { error: { status: 400, message: "Codes are required" } };
    }
    const codes = [
      ...new Set(codesRaw.map((c) => normalizeCode(c)).filter(Boolean)),
    ];
    if (codes.length === 0) {
      return { error: { status: 400, message: "Codes are required" } };
    }

    const ops = codes.map((code, i) => ({
      updateOne: {
        filter: { userId, accountId, code },
        update: { $set: { sort_order: i } },
      },
    }));
    await WatchlistItem.bulkWrite(ops, { ordered: false });
    await delRedis(REDIS_ACCOUNT_KEY(accountId));

    return { data: codes, message: "Watchlist order saved" };
  },

  async getOne(userId, accountIdRaw, codeRaw) {
    const accountId = normalizeAccountId(accountIdRaw);
    const code = normalizeCode(codeRaw);

    if (!accountId) return { error: { status: 400, message: "AccountId is required" } };
    if (!code) return { error: { status: 400, message: "Code is required" } };

    const instrument = await InstrumentModel.findOne({ code }).select("isActive");

    if (!instrument) {
      return { error: { status: 404, message: "Instrument not found" } };
    }

    if (instrument.isActive !== true) {
      return { error: { status: 400, message: "Instrument is not active" } };
    }

    const item = await WatchlistItem.findOne({
      userId,
      accountId,
      code,
      isAdded: true,
    }).select("_id code name isAdded accountId userId createdAt updatedAt");

    if (!item) {
      return { error: { status: 404, message: "Item not found in watchlist" } };
    }

    return { data: item };
  },

  async addUserItem(userId, accountIdRaw, payload) {
    const accountId = normalizeAccountId(accountIdRaw);
    const code = normalizeCode(payload?.code);

    if (!accountId) return { error: { status: 400, message: "AccountId is required" } };
    if (!code) return { error: { status: 400, message: "Code is required" } };
    if (code.length > 30)
      return { error: { status: 400, message: "Code is too long" } };

    try {
      const instrument = await InstrumentModel.findOne({ code }).select(
        "code name isActive"
      );

      if (!instrument) {
        return { error: { status: 404, message: "Instrument not found" } };
      }

      if (instrument.isActive !== true) {
        return { error: { status: 400, message: "Instrument is not active" } };
      }

      const instrumentName = normalizeName(instrument.name);

      if (!instrumentName) {
        return { error: { status: 400, message: "Instrument name is missing" } };
      }

      if (instrumentName.length > 60) {
        return { error: { status: 400, message: "Name is too long" } };
      }

      const existing = await WatchlistItem.findOne({
        userId,
        accountId,
        code,
      }).select("_id code name isAdded accountId userId createdAt updatedAt");

      if (existing) {
        if (existing.isAdded === true) {
          return {
            error: {
              status: 409,
              message: "This instrument is already added in your watchlist",
            },
          };
        }

        existing.isAdded = true;
        existing.name = instrumentName;

        await existing.save();

        await delRedis(REDIS_ACCOUNT_KEY(accountId));

        return {
          data: existing,
          message: "Instrument added back to your watchlist",
        };
      }

      const created = await WatchlistItem.create({
        userId,
        accountId,
        code,
        name: instrumentName,
        isAdded: true,
      });

      await delRedis(REDIS_ACCOUNT_KEY(accountId));

      return {
        data: {
          _id: created._id,
          code: created.code,
          name: created.name,
          isAdded: created.isAdded,
          accountId: created.accountId,
          userId: created.userId,
          createdAt: created.createdAt,
          updatedAt: created.updatedAt,
        },
        message: "Instrument added to watchlist",
      };
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === 11000
      ) {
        return {
          error: {
            status: 409,
            message: "This instrument is already added in your watchlist",
          },
        };
      }

      return {
        error: { status: 500, message: "Failed to add watchlist item" },
      };
    }
  },

  async removeUserItem(userId, accountIdRaw, codeRaw) {
    const accountId = normalizeAccountId(accountIdRaw);
    const code = normalizeCode(codeRaw);

    if (!accountId) return { error: { status: 400, message: "AccountId is required" } };
    if (!code) return { error: { status: 400, message: "Code is required" } };

    const updated = await WatchlistItem.findOneAndUpdate(
      { userId, accountId, code, isAdded: true },
      { $set: { isAdded: false } },
      { new: true }
    ).select("_id code name isAdded accountId userId createdAt updatedAt");

    if (!updated) {
      return { error: { status: 404, message: "Item not found in watchlist" } };
    }

    await delRedis(REDIS_ACCOUNT_KEY(accountId));

    return { data: updated, message: "Instrument removed from watchlist" };
  },

async getSegmentsWithCounts(userId, accountIdRaw) {
  const accountId = normalizeAccountId(accountIdRaw);
  if (!accountId) {
    return { error: { status: 400, message: "AccountId is required" } };
  }

  const addedItems = await WatchlistItem.find({
    userId,
    accountId,
    isAdded: true,
  }).select("code");
  const addedCodes = addedItems
    .map((x) => normalizeCode(x.code))
    .filter(Boolean);

  const rows = await InstrumentModel.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: { $ifNull: ["$segment", ""] },
        total: { $sum: 1 },
        added: {
          $sum: {
            $cond: [{ $in: [{ $toUpper: "$code" }, addedCodes] }, 1, 0],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const data = rows
    .map((r) => ({
      segment: String(r._id || "").trim().toUpperCase() || "OTHER",
      total: r.total || 0,
      added: r.added || 0,
    }))
    .filter((r) => r.total > 0);

  return { data };
},
async getSegmentInstrumentsWithStatus(userId, accountIdRaw, segmentRaw, limit) {
  const accountId = normalizeAccountId(accountIdRaw);
  const segment = String(segmentRaw || "").trim().toUpperCase();
  const segmentKey = segment === "COMMODITIES" ? "COMMODITY" : segment;
  const segmentFilter =
    segmentKey === "COMMODITY"
      ? { $in: ["ENERGY", "METAL"] }
      : segment;

  if (!accountId) {
    return { error: { status: 400, message: "AccountId is required" } };
  }

  if (!segmentKey) {
    return { error: { status: 400, message: "Segment is required" } };
  }

  //  Cache key (unique per user + account + segment + limit)
  const cacheKey = `account:segment:watchlist:v1:${String(userId)}:${String(
    accountId
  )}:${String(segmentKey)}:${String(limit)}`;

  //  Return fast from Redis
  const cached = await getRedisJSON(cacheKey);
  if (Array.isArray(cached)) {
    return { data: cached };
  }

  //  fetch instruments segment wise (only active)
  const instruments = await InstrumentModel.find({
    segment: segmentFilter,
    isActive: true,
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .select("code name segment isActive");

  if (!Array.isArray(instruments) || instruments.length === 0) {
    await setRedisJSON(cacheKey, [], 30);
    return { data: [] };
  }

  const codes = instruments.map((x) => normalizeCode(x.code)).filter(Boolean);

  //  user watchlist items for same segment instruments
  const userItems = await WatchlistItem.find({
    userId,
    accountId,
    code: { $in: codes },
    isAdded: true,
  }).select("code");

  const userCodeSet = new Set(
    userItems.map((x) => normalizeCode(x.code)).filter(Boolean)
  );

  const finalList = instruments.map((inst) => {
    const code = normalizeCode(inst.code);
    const name = normalizeName(inst.name);

    return {
      code,
      name,
      segment: String(inst.segment || ""),
      isAdded: userCodeSet.has(code),
    };
  });

  //  Save in Redis (30 sec cache)
  await setRedisJSON(cacheKey, finalList, 30);

  return { data: finalList };
},
async searchInstrumentsOnly(qRaw, segmentRaw, limit) {
  const q = String(qRaw || "").trim();
  const segment = String(segmentRaw || "").trim().toUpperCase();

  if (!q) {
    return { error: { status: 400, message: "Search query (q) is required" } };
  }

  if (q.length > 50) {
    return { error: { status: 400, message: "Search query is too long" } };
  }

  //  Redis cache key (global, best for 10k users)
  const cacheKey = `instrument:search:only:v1:${String(
    segment || "ALL"
  )}:${String(q.toUpperCase())}:${String(limit)}`;

  const cached = await getRedisJSON(cacheKey);
  if (Array.isArray(cached)) {
    return { data: cached };
  }

  const filter = {
    isActive: true,
    $or: [
      { code: { $regex: q, $options: "i" } },
      { name: { $regex: q, $options: "i" } },
    ],
  };

  if (segment) {
    filter.segment = segment;
  }

  const instruments = await InstrumentModel.find(filter)
    .sort({ _id: -1 })
    .limit(limit)
    .select("code name segment")
    .lean();

  if (!Array.isArray(instruments) || instruments.length === 0) {
    await setRedisJSON(cacheKey, [], 20);
    return { data: [] };
  }

  const finalList = instruments.map((inst) => ({
    code: normalizeCode(inst.code),
    name: normalizeName(inst.name),
    segment: String(inst.segment || ""),
  }));

  await setRedisJSON(cacheKey, finalList, 20);

  return { data: finalList };
},
};
