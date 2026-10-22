// Chart candles cache: Redis pehle, Redis band ho to chhota memory cache.
// Ek hi key ke parallel requests ek hi provider call share karte hain.
import redis, { isRedisReady } from "../../config/redis.js";
import {
  CACHE_KEY_PREFIX,
  MEMORY_CACHE_MAX_ENTRIES,
} from "./chart.constants.js";

const memory = new Map(); // key -> { value, expiresAt }
const inflight = new Map(); // key -> Promise

export const cacheKey = ({ code, base, endTs, count }) =>
  `${CACHE_KEY_PREFIX}:${code}:${base}:${endTs || "latest"}:${count}`;

function memoryGet(key) {
  const hit = memory.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    memory.delete(key);
    return null;
  }
  return hit.value;
}

function memorySet(key, value, ttlSeconds) {
  if (memory.size >= MEMORY_CACHE_MAX_ENTRIES) {
    // Sabse purani entry hatao (Map insertion order).
    memory.delete(memory.keys().next().value);
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function read(key) {
  if (isRedisReady()) {
    try {
      const raw = await redis.get(key);
      if (raw) return JSON.parse(raw);
    } catch {
      // Redis error -> memory fallback
    }
  }
  return memoryGet(key);
}

async function write(key, value, ttlSeconds) {
  memorySet(key, value, ttlSeconds);
  if (!isRedisReady()) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch {
    // memory me to hai hi
  }
}

/**
 * Cache se do, warna [loader] chalao aur cache karo.
 * @returns {Promise<{ value: any, cached: boolean }>}
 */
export async function remember(key, ttlSeconds, loader) {
  const cached = await read(key);
  if (cached) return { value: cached, cached: true };

  const running = inflight.get(key);
  if (running) return { value: await running, cached: false };

  const p = (async () => {
    const value = await loader();
    if (Array.isArray(value) && value.length > 0) {
      await write(key, value, ttlSeconds);
    }
    return value;
  })();
  inflight.set(key, p);
  try {
    return { value: await p, cached: false };
  } finally {
    inflight.delete(key);
  }
}
