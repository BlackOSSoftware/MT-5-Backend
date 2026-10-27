// ws/alltick.manager.js
// Full file with aggressive, actionable debug to determine exactly why spread isn't applied.
// Logs are throttled to avoid console spam but by default are very verbose.
// Set env:
//   ALLTICK_DEBUG=1      -> verbose per-client logs (helpful during troubleshooting)
//   ALLTICK_DEBUG_THROTTLE_MS=1000 -> throttle per-symbol summary (ms)
// Keep this single file; paste over your existing file.

import WebSocket from "ws";
import EventEmitter from "events";
import { v4 as uuidv4 } from "uuid";
import dotenv from "dotenv";
import Redis from "ioredis";
import { HighLowService } from "../services/highlow.service.js";
import {
  findInstrumentByAnySymbol,
  normalizeProviderCode,
  resolveInstrumentProviderCode,
} from "../services/instrumentProvider.service.js";
import { resolveSeedQuote } from "../services/quoteSeed.service.js";
import { tradeEngine } from "../trade-engine/bootstrap.js";
import EngineSync from "../trade-engine/EngineSync.js";
import { engineEvents } from "../trade-engine/EngineEvents.js";

dotenv.config();

// ========================
// CONFIG
// ========================
const ALLTICK_TOKEN = String(process.env.ALLTICK_API_KEY || "").trim();
const CRYPTO_URL = `${process.env.ALLTICK_CRYPTO_WS_URL}?token=${ALLTICK_TOKEN}`;
const STOCK_URL = `${process.env.ALLTICK_STOCK_WS_URL}?token=${ALLTICK_TOKEN}`;

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const REDIS_CHANNEL = "engine:events";
const SILVER_FALLBACK_ENABLED =
  String(process.env.SILVER_FALLBACK_ENABLED || "true").toLowerCase() !==
  "false";
const SILVER_FALLBACK_INTERVAL_MS = Math.max(
  3000,
  Number(process.env.SILVER_FALLBACK_INTERVAL_MS || 5000),
);
const SILVER_FALLBACK_YAHOO_SYMBOL =
  process.env.SILVER_FALLBACK_YAHOO_SYMBOL || "SI=F";

// Debug flags
const DBG_VERBOSE = String(process.env.ALLTICK_DEBUG || "0") === "1" || String(process.env.ALLTICK_DEBUG || "0") === "true";
const LOG_THROTTLE_MS = Number(process.env.ALLTICK_DEBUG_THROTTLE_MS || 1500);
const INSTANCE_ID = `${process.pid}-${uuidv4()}`;

// ========================
// Redis pub/sub
// ========================
const redisPub = new Redis(REDIS_URL);
const redisSub = new Redis(REDIS_URL);

redisSub.subscribe(REDIS_CHANNEL, (err) => {
  if (err) console.error("[ALLTICK-MGR][REDIS] subscribe error", err);
  else console.log("[ALLTICK-MGR] subscribed to", REDIS_CHANNEL);
});

// ========================
// Helpers
// ========================
const nowTs = () => Date.now();
const buildTrace = () => `${uuidv4()}-${nowTs()}`;

const normalizeMarket = (v) =>
  String(v || "")
    .trim()
    .toLowerCase();
const normalizeFeedMarket = (v) => {
  const market = normalizeMarket(v);
  // AllTick: equities → quote-stock WS; forex/metal/crypto/indices/energy → quote-b (crypto) WS.
  // Matches quoteSeed.service feedMarketForSegment (metal/forex seed already uses crypto REST).
  if (
    market === "stock" ||
    market === "stocks" ||
    market === "equity" ||
    market === "equities"
  ) {
    return "stock";
  }
  return "crypto";
};

const marketsForFeed = (feedMarket) => {
  const feed = normalizeFeedMarket(feedMarket);
  if (feed === "stock") return ["stock"];
  // Clients may subscribe as metal/forex while upstream is quote-b (crypto).
  return ["crypto", "forex", "metal", "indices", "energy"];
};
const normalizeSymbol = (v) =>
  String(v || "")
    .trim()
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
const makeKey = (market, symbol) =>
  `${normalizeMarket(market)}:${normalizeSymbol(symbol)}`;

const safeNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

const firstFiniteNumber = (...values) => {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = safeNum(value);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
};

let silverFallbackTimer = null;
let silverFallbackLast = null;

function isSilverSymbol(value) {
  const s = normalizeSymbol(value);
  return s === "SILVER" || s === "XAGUSD";
}

function hasSilverSubscribers() {
  const silverKeys = [
    makeKey("crypto", "SILVER"),
    makeKey("crypto", "XAGUSD"),
    makeKey("metal", "SILVER"),
    makeKey("metal", "XAGUSD"),
  ];

  for (const subs of clientSubscriptions.values()) {
    if (silverKeys.some((key) => subs?.has(key))) return true;
  }
  return false;
}

function lastFiniteNumber(values) {
  if (!Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const n = safeNum(values[i]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

async function fetchSilverFallbackQuote() {
  const encoded = encodeURIComponent(SILVER_FALLBACK_YAHOO_SYMBOL);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1d&interval=1m`;

  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  if (!resp.ok) {
    throw new Error(`silver fallback http ${resp.status}`);
  }

  const json = await resp.json();
  const result = json?.chart?.result?.[0];
  const quote = result?.indicators?.quote?.[0] || {};
  const meta = result?.meta || {};

  const latestClose = lastFiniteNumber(quote.close);
  const price = firstFiniteNumber(
    latestClose,
    meta.regularMarketPrice,
    meta.previousClose,
  );

  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("silver fallback missing price");
  }

  const open = firstFiniteNumber(
    lastFiniteNumber(quote.open),
    meta.regularMarketOpen,
    price,
  );
  const high = Math.max(
    lastFiniteNumber(quote.high) ?? price,
    price,
  );
  const low = Math.min(
    lastFiniteNumber(quote.low) ?? price,
    price,
  );
  const close = firstFiniteNumber(meta.previousClose, price);

  return {
    price,
    open,
    high,
    low,
    close,
    updatedAt: Date.now(),
    source: "yahoo_silver_fallback",
  };
}

async function pushSilverFallbackTick() {
  if (!SILVER_FALLBACK_ENABLED || !hasSilverSubscribers()) {
    if (silverFallbackTimer) {
      clearInterval(silverFallbackTimer);
      silverFallbackTimer = null;
    }
    return;
  }

  try {
    silverFallbackLast = await fetchSilverFallbackQuote();
    const mid = silverFallbackLast.price;
    const bid = Number((mid - 0.01).toFixed(5));
    const ask = Number((mid + 0.01).toFixed(5));
    const ts = String(Date.now());

    const data = {
      code: "SILVER",
      seq: ts,
      tick_time: ts,
      bids: [{ price: bid, volume: "1" }],
      asks: [{ price: ask, volume: "1" }],
      dayOpen: silverFallbackLast.open,
      dayHigh: silverFallbackLast.high,
      dayLow: silverFallbackLast.low,
      dayClose: silverFallbackLast.close,
      source: silverFallbackLast.source,
    };

    broadcastData("crypto", data);
    broadcastData("metal", data);
    broadcastData("crypto", { ...data, code: "XAGUSD" });
    broadcastData("metal", { ...data, code: "XAGUSD" });
    feedEnginePrice(data);
  } catch (err) {
    WARN("[SILVER-FALLBACK] failed", err?.message || err);
  }
}

function startSilverFallbackIfNeeded(symbols = []) {
  if (!SILVER_FALLBACK_ENABLED) return;
  if (!symbols.some(isSilverSymbol)) return;
  if (!silverFallbackTimer) {
    silverFallbackTimer = setInterval(
      pushSilverFallbackTick,
      SILVER_FALLBACK_INTERVAL_MS,
    );
  }
  pushSilverFallbackTick();
}

// Lightweight DBG functions controlled by env
function DBG(...args) {
  if (DBG_VERBOSE) console.debug("[ALLTICK-MGR][DBG]", ...args);
}
function INFO(...args) {
  console.info("[ALLTICK-MGR]", ...args);
}
function WARN(...args) {
  console.warn("[ALLTICK-MGR]", ...args);
}
function ERROR(...args) {
  console.error("[ALLTICK-MGR]", ...args);
}

// throttled per-symbol summary logging (prevents flood but gives clear status)
const lastTickLog = new Map(); // symbol -> timestamp
function shouldLogForSymbol(symbol) {
  try {
    const last = lastTickLog.get(symbol) || 0;
    const now = Date.now();
    if (now - last > LOG_THROTTLE_MS) {
      lastTickLog.set(symbol, now);
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

// per-client per-symbol small throttle for very verbose logs
const clientSymbolLogTs = new Map(); // `${clientId}:${symbol}` -> timestamp
function shouldLogClientSymbol(clientId, symbol) {
  try {
    const key = `${clientId}:${symbol}`;
    const last = clientSymbolLogTs.get(key) || 0;
    const now = Date.now();
    if (now - last > LOG_THROTTLE_MS) {
      clientSymbolLogTs.set(key, now);
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

// rounding helpers: bids should not round up, asks should not round down
function applyTickAndPrecision(value, tick, prec, isBid) {
  if (typeof value !== "number" || Number.isNaN(value)) return value;
  let v = value;
  if (tick > 0) {
    if (isBid) v = Math.floor(v / tick) * tick; // bids down
    else v = Math.ceil(v / tick) * tick; // asks up
  }
  if (typeof prec === "number") v = Number(v.toFixed(prec));
  return v;
}

/** BTCUSD ↔ BTCUSDT (and GOLD/XAU etc.) for engine lookups. */
function instrumentAliases(symbol) {
  const s = normalizeSymbol(symbol);
  if (!s) return [];
  const out = [s];
  if (s.endsWith("USDT") && s.length > 4) out.push(s.slice(0, -1));
  else if (s.endsWith("USD") && !s.endsWith("USDT") && s.length > 3) {
    out.push(`${s}T`);
  }
  if (s === "GOLD") out.push("XAUUSD");
  if (s === "XAUUSD") out.push("GOLD");
  if (s === "SILVER") out.push("XAGUSD");
  if (s === "XAGUSD") out.push("SILVER");
  return [...new Set(out)];
}

function symbolsMatch(a, b) {
  const set = new Set(instrumentAliases(a));
  return instrumentAliases(b).some((x) => set.has(x));
}

// find symbol in engine with loose matching (case / aliases)
function findSymbolInEngine(symbol) {
  try {
    if (!tradeEngine || !tradeEngine.symbols) return null;
    for (const a of instrumentAliases(symbol)) {
      if (tradeEngine.symbols.has(a)) return tradeEngine.symbols.get(a);
    }
    const want = normalizeSymbol(symbol);
    for (const [k, v] of tradeEngine.symbols.entries()) {
      if (normalizeSymbol(k) === want || symbolsMatch(k, want)) return v;
    }
  } catch (err) {
    DBG("findSymbolInEngine error", err && err.message ? err.message : err);
  }
  return null;
}

// Load/refresh account into engine memory from DB (always refresh on identify).
async function ensureEngineAccount(accountId, { forceRefresh = false } = {}) {
  if (!accountId || !tradeEngine) return null;
  const id = String(accountId);
  let acc = tradeEngine.accounts && tradeEngine.accounts.get(id);
  if (acc && !forceRefresh) return acc;

  try {
    acc = await EngineSync.refreshAccountForLive(id);
    INFO(
      "ensureEngineAccount: refreshed account into engine",
      id,
      acc ? "OK" : "FAILED",
      forceRefresh ? "force" : "miss",
    );
    return acc || null;
  } catch (err) {
    DBG(
      "ensureEngineAccount refresh threw",
      err && err.message ? err.message : err,
    );
    return null;
  }
}

// ========================
// AllTick WS Manager
// ========================
class AlltickWS extends EventEmitter {
  constructor(url, marketName) {
    super();
    this.url = url;
    this.marketName = marketName;

    this.client = null;
    this.subscriptions = new Map();
    this.pendingSubscriptions = new Map();
    this.connected = false;

    this.heartbeatTimer = null;
    this.reconnectTimer = null;
    this.seqId = 1;
    this.pushTimer = null;
    this.lastPushPending = [];

    this.isConnecting = false;
    this.reconnectAttempts = 0;
    this.manualClose = false;
    this._lastSubscribePushAt = 0;
    this._subscribeBackoffUntil = 0;
  }

  nextSeqId() {
    this.seqId += 1;
    if (this.seqId > 999999999) this.seqId = 1;
    return this.seqId;
  }

  connect() {
    if (!ALLTICK_TOKEN) {
      ERROR(`[${this.marketName}] ALLTICK_API_KEY missing`);
      return;
    }

    if (this.connected || this.isConnecting) return;
    this.isConnecting = true;
    this.manualClose = false;

    if (this.client) {
      try {
        this.client.removeAllListeners();
        this.client.terminate();
      } catch {}
    }

    INFO(`[${this.marketName}] Connecting to AllTick...`);

    this.client = new WebSocket(this.url, { handshakeTimeout: 10000 });

    this.client.on("open", () => {
      this.connected = true;
      this.isConnecting = false;
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      INFO(`[${this.marketName}] Connected to AllTick WS`);
      this.emit("ready");
      this.startHeartbeat();
      this.restoreSubscriptions();
    });

    this.client.on("message", (raw) => {
      try {
        const json = JSON.parse(raw.toString());

        // heartbeat/data/subscribed handling based on provider cmd_id
        if (json.cmd_id === 22003) {
          const pending = this.lastPushPending;
          if (json.ret === 200) {
            for (const sub of pending) {
              this.pendingSubscriptions.delete(sub.symbol);
            }
            this.emit("subscribed", {
              ack: json,
              subscriptions: pending,
            });
          } else {
            const providerMsg = String(json.msg || "").toLowerCase();
            if (providerMsg.includes("code invalid")) {
              for (const sub of pending) {
                this.pendingSubscriptions.delete(sub.symbol);
                this.subscriptions.delete(sub.symbol);
              }
            }
            this.emit("subscribe_error", {
              ack: json,
              subscriptions: pending,
            });
          }
          return;
        }

        if (json.cmd_id === 22999 && json.data) {
          this.emit("data", json.data);
          return;
        }

        if (json.cmd_id === 22998) {
          this.emit("heartbeat_ack", json);
          return;
        }

        this.emit("raw", json);
      } catch (err) {
        ERROR(`[${this.marketName}] Invalid JSON`, err && err.message ? err.message : err);
      }
    });

    this.client.on("close", (code, reason) => {
      const reasonStr = reason ? reason.toString() : "";
      WARN(`[${this.marketName}] WS Closed`, code, reasonStr);
      this.cleanupAndReconnect(code, reasonStr);
    });

    this.client.on("error", (err) => {
      ERROR(`[${this.marketName}] WS Error`, err && err.message ? err.message : err);
      this.cleanupAndReconnect();
    });
  }

  cleanupAndReconnect(code = null, reason = "") {
    try {
      if (this.client) {
        try {
          this.client.removeAllListeners();
        } catch {}
        try {
          this.client.terminate();
        } catch {}
      }
    } catch {}

    this.client = null;
    this.connected = false;
    this.isConnecting = false;
    this.stopHeartbeat();

    if (this.manualClose) {
      INFO(`[${this.marketName}] manual close, not reconnecting`);
      return;
    }

    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;

    this.reconnectAttempts += 1;
    const delay = Math.min(5000 * this.reconnectAttempts, 60000);

    INFO(`[${this.marketName}] Reconnecting in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.connected || this.isConnecting) return;
      this.connect();
    }, delay);
  }

  startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    this.heartbeatTimer = setInterval(() => {
      if (!this.connected || !this.client) return;

      const payload = {
        cmd_id: 22998,
        seq_id: this.nextSeqId(),
        trace: buildTrace(),
      };

      try {
        this.client.send(JSON.stringify(payload));
      } catch (err) {
        ERROR(`[${this.marketName}] Heartbeat send failed`, err && err.message ? err.message : err);
        try {
          this.client.terminate();
        } catch {}
      }
    }, 20000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  closeManual() {
    this.manualClose = true;
    try {
      if (this.client) this.client.close(1000, "manual");
    } catch {}
    this.stopHeartbeat();
  }

  /**
   * @param codeRaw app / any symbol (normalized uppercase for map key)
   * @param levelRaw depth
   * @param providerCodeRaw AllTick code — case-sensitive (e.g. "Silver")
   */
  subscribe(codeRaw, levelRaw = 5, providerCodeRaw = null) {
    const symbol = normalizeSymbol(codeRaw);
    // Prefer explicit provider code; do NOT uppercase (AllTick: "Silver" ≠ "SILVER")
    const providerCode = normalizeProviderCode(
      providerCodeRaw || codeRaw,
    );
    const depth = Number(levelRaw) || 5;

    if (!symbol || !providerCode) return;

    const existing = this.subscriptions.get(symbol);
    // Same symbol already tracked — skip re-push (AllTick 605 rate-limit).
    if (
      existing &&
      existing.providerCode === providerCode &&
      existing.depth === depth &&
      !this.pendingSubscriptions.has(symbol)
    ) {
      return;
    }

    const record = { symbol, providerCode, depth };
    this.subscriptions.set(symbol, record);
    this.pendingSubscriptions.set(symbol, record);
    this.schedulePushSubscription();
  }

  schedulePushSubscription(delayMs = 1200) {
    if (this.pushTimer) clearTimeout(this.pushTimer);
    const backoffLeft = Math.max(0, (this._subscribeBackoffUntil || 0) - nowTs());
    const wait = Math.max(delayMs, backoffLeft);
    this.pushTimer = setTimeout(() => this.pushSubscription(), wait);
  }

  pushSubscription() {
    if (!this.connected || !this.client) return;
    if (this.subscriptions.size === 0) return;
    if (this.pendingSubscriptions.size === 0) return;

    // Min gap between upstream subscribe pushes (AllTick ret 605).
    const sinceLast = nowTs() - (this._lastSubscribePushAt || 0);
    if (sinceLast < 2000) {
      this.schedulePushSubscription(2000 - sinceLast);
      return;
    }

    const symbolList = [];
    for (const { providerCode, depth } of this.subscriptions.values()) {
      symbolList.push({ code: providerCode, depth_level: depth });
    }

    this.lastPushPending = Array.from(this.pendingSubscriptions.values()).map(
      ({ symbol, providerCode, depth }) => ({
        symbol,
        providerCode,
        depth,
      }),
    );

    const payload = {
      cmd_id: 22002,
      seq_id: this.nextSeqId(),
      trace: buildTrace(),
      data: { symbol_list: symbolList },
    };

    try {
      this._lastSubscribePushAt = nowTs();
      this.client.send(JSON.stringify(payload));
    } catch (err) {
      ERROR(`[${this.marketName}] pushSubscription send failed`, err && err.message ? err.message : err);
    }
  }

  /** After AllTick 605 / rate limit — retry pending with backoff. */
  scheduleSubscribeRetry(backoffMs = 5000) {
    this._subscribeBackoffUntil = nowTs() + backoffMs;
    if (this.pendingSubscriptions.size > 0) {
      this.schedulePushSubscription(backoffMs);
    }
  }

  restoreSubscriptions() {
    if (this.subscriptions.size > 0) {
      this.pendingSubscriptions = new Map(this.subscriptions);
      this.schedulePushSubscription(500);
    }
  }
}

// ========================
// INIT CONNECTIONS
// ========================
export const wsCrypto = new AlltickWS(CRYPTO_URL, "crypto");
export const wsStock = new AlltickWS(STOCK_URL, "stock");

// start connections (singletons)
wsCrypto.connect();
wsStock.connect();

function notifyUpstreamSubscribeFailure(market, subscriptions, ack) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return;

  for (const sub of subscriptions) {
    const key = makeKey(market, sub.symbol);

    for (const [clientId, subs] of clientSubscriptions.entries()) {
      if (!subs || !subs.has(key)) continue;

      const ws = wsClients.get(clientId);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;

      try {
        ws.send(
          JSON.stringify({
            status: "error",
            error: "upstream subscribe failed",
            symbol: sub.symbol,
            providerSymbol: sub.providerCode,
            market,
            providerRet: ack?.ret ?? null,
            providerMsg: ack?.msg ?? null,
          }),
        );
      } catch (err) {
        ERROR(
          "[WS SEND ERROR] upstream subscribe failed ->",
          err && err.message ? err.message : err,
        );
      }
    }
  }
}

function attachSubscriptionLogs(manager) {
  manager.on("subscribed", ({ ack, subscriptions }) => {
    INFO(`[${manager.marketName}] subscribe ok`, {
      providerRet: ack?.ret ?? null,
      providerMsg: ack?.msg ?? null,
      symbols: subscriptions.map((sub) => sub.providerCode),
    });
  });

  manager.on("subscribe_error", ({ ack, subscriptions }) => {
    WARN(`[${manager.marketName}] subscribe failed`, {
      providerRet: ack?.ret ?? null,
      providerMsg: ack?.msg ?? null,
      symbols: subscriptions.map((sub) => sub.providerCode),
    });
    notifyUpstreamSubscribeFailure(manager.marketName, subscriptions, ack);
    // AllTick 605 too many requests — backoff then retry pending.
    const ret = Number(ack?.ret);
    const msg = String(ack?.msg || "").toLowerCase();
    if (ret === 605 || msg.includes("too many")) {
      manager.scheduleSubscribeRetry(8000);
    } else if (manager.pendingSubscriptions.size > 0) {
      manager.scheduleSubscribeRetry(3000);
    }
  });
}

attachSubscriptionLogs(wsCrypto);
attachSubscriptionLogs(wsStock);

// ========================
// CLIENT REGISTRY + INDEXES
// ========================
export const wsClients = new Map(); // clientId -> ws
const clientSubscriptions = new Map(); // clientId -> Set(keys)
const accountIdMap = new Map(); // accountId -> Set(clientId)

function ensureClientSubs(clientId) {
  if (!clientSubscriptions.has(clientId))
    clientSubscriptions.set(clientId, new Set());
}
function ensureAccountSet(accountId) {
  if (!accountIdMap.has(accountId)) accountIdMap.set(accountId, new Set());
}

// register client
export function registerClient(client) {
  const id = uuidv4();
  client.clientId = id;
  client.routes = new Set(); // "market" and/or "account"
  wsClients.set(id, client);
  clientSubscriptions.set(id, new Set());
  ensureClientSubs(id);
  DBG("Connected client", id);
  return id;
}

/** Quotes UI: market open/closed → gray bid/ask. Broadcast to market-route clients. */
export function broadcastMarketStatus(status) {
  if (!status?.segment) return;
  const payload = JSON.stringify({
    type: "market_status",
    data: {
      segment: String(status.segment).toLowerCase(),
      isMarketOpen: status.isMarketOpen === true,
      reason: status.reason || null,
      openTime: status.openTime || null,
      closeTime: status.closeTime || null,
      timezone: status.timezone || null,
      lastCheckedAt: status.lastCheckedAt || new Date().toISOString(),
    },
  });
  for (const ws of wsClients.values()) {
    try {
      if (ws.readyState === 1 && ws.routes?.has("market")) {
        ws.send(payload);
      }
    } catch (_) {}
  }
}

// remove client and cleanup maps
export function removeClient(id) {
  const ws = wsClients.get(id);
  if (!ws) return;
  if (ws.accountId) {
    const set = accountIdMap.get(ws.accountId);
    if (set) {
      set.delete(id);
      DBG("removed client from account map", ws.accountId, "remaining:", set.size);
      if (set.size === 0) accountIdMap.delete(ws.accountId);
    }
  }
  if (ws.engineAccount) {
    ws.engineAccount = null;
  }
  clientSubscriptions.delete(id);
  wsClients.delete(id);
  DBG("Disconnected client", id);
}

function forwardEventToLocalClients(eventType, payload) {
  if (!eventType || !payload) return false;

  if (eventType === "LIVE_ACCOUNT") {
    const s = accountIdMap.get(String(payload.accountId));
    if (!s || s.size === 0) return true;
    const msgStr = JSON.stringify({ type: "live_account", data: payload });
    let sent = 0;
    for (const clientId of s) {
      const ws = wsClients.get(clientId);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      if (!ws.routes || !ws.routes.has("account")) continue;
      try {
        ws.send(msgStr);
        sent++;
      } catch (err) {
        ERROR("[WS SEND ERROR] live_account ->", err && err.message ? err.message : err);
      }
    }
    DBG(`forwarded live_account to ${sent}/${s.size} clients for account ${payload.accountId}`);
    return true;
  }

  if (eventType === "LIVE_POSITION") {
    const s = accountIdMap.get(String(payload.accountId));
    if (!s || s.size === 0) return true;
    const msgStr = JSON.stringify({ type: "live_position", data: payload });
    let sent = 0;
    for (const clientId of s) {
      const ws = wsClients.get(clientId);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      if (!ws.routes || !ws.routes.has("account")) continue;
      try {
        ws.send(msgStr);
        sent++;
      } catch (err) {
        ERROR("[WS SEND ERROR] live_position ->", err && err.message ? err.message : err);
      }
    }
    DBG(`forwarded live_position to ${sent}/${s.size} clients for account ${payload.accountId}`);
    return true;
  }

  if (eventType === "LIVE_POSITION_CLOSED") {
    const s = accountIdMap.get(String(payload.accountId));
    if (!s || s.size === 0) return true;
    const msgStr = JSON.stringify({ type: "live_position_closed", data: payload });
    let sent = 0;
    for (const clientId of s) {
      const ws = wsClients.get(clientId);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      if (!ws.routes || !ws.routes.has("account")) continue;
      try {
        ws.send(msgStr);
        sent++;
      } catch (err) {
        ERROR("[WS SEND ERROR] live_position_closed ->", err && err.message ? err.message : err);
      }
    }
    DBG(`forwarded live_position_closed to ${sent}/${s.size} clients for account ${payload.accountId}`);
    return true;
  }

  if (
    [
      "LIVE_PENDING",
      "LIVE_PENDING_EXECUTE",
      "LIVE_PENDING_CANCEL",
      "LIVE_PENDING_EXECUTE_FAILED",
      "LIVE_PENDING_MODIFY",
    ].includes(eventType)
  ) {
    const accountId = String(payload.accountId);
    const clients = accountIdMap.get(accountId);
    if (!clients || clients.size === 0) {
      DBG("no subscribers for pending event account", accountId);
      return true;
    }

    const typeMap = {
      LIVE_PENDING: "live_pending",
      LIVE_PENDING_EXECUTE: "live_pending_execute",
      LIVE_PENDING_CANCEL: "live_pending_cancel",
      LIVE_PENDING_EXECUTE_FAILED: "live_pending_execute_failed",
      LIVE_PENDING_MODIFY: "live_pending_modify",
    };

    const type = typeMap[eventType] || "live_pending";

    const msgStr = JSON.stringify({ type, data: payload });
    let sent = 0;
    for (const clientId of clients) {
      const ws = wsClients.get(clientId);
      if (!ws || ws.readyState !== WebSocket.OPEN) continue;
      if (!ws.routes || !ws.routes.has("account")) continue;
      try {
        ws.send(msgStr);
        sent++;
      } catch (err) {
        ERROR("[WS SEND ERROR]", type, "->", err && err.message ? err.message : err);
      }
    }
    DBG(`forwarded ${type} to ${sent}/${clients.size} clients for account ${accountId}`);
    return true;
  }

  return false;
}

// ========================
// BROADCAST ORDERBOOK (market route only)
// - Applies per-account+per-symbol spread/tick/precision only for those
//   clients who are identified (or provided accountId via subscribe) and have spread_enabled != false.
// - Others receive raw AllTick data.
// Detailed debug reasons are logged for any client that didn't get spread.
// ========================
function broadcastData(market, data) {
  const feedMarket = normalizeFeedMarket(market);
  const raw =
    data?.code ||
    data?.symbol ||
    data?.s ||
    data?.instrument ||
    data?.instrument_code;

  const symbol = normalizeSymbol(raw);
  if (!symbol) return;

  // Match clients subscribed under any UI market that shares this AllTick feed
  // (e.g. metal/forex → stock feed).
  const keys = new Set();
  for (const m of marketsForFeed(feedMarket)) {
    keys.add(makeKey(m, symbol));
  }
  keys.add(makeKey(market, symbol));
  keys.add(makeKey(feedMarket, symbol));

  const bestBidRaw = data?.bids?.[0]?.price;
  const bestAskRaw = data?.asks?.[0]?.price;

  const bestBid = safeNum(bestBidRaw);
  const bestAsk = safeNum(bestAskRaw);

  DBG("broadcast orderbook ->", market, symbol, "clients:", wsClients.size);

  let appliedCount = 0;
  let rawCount = 0;

  // iterate clients and send either raw or adjusted per-account feed
  for (const [id, ws] of wsClients.entries()) {
    if (!ws || ws.readyState !== WebSocket.OPEN) continue;
    if (!ws.routes || !ws.routes.has("market")) continue;
    const subs = clientSubscriptions.get(id);
    if (!subs || !Array.from(keys).some((key) => subs.has(key))) continue;

    try {
      // default: raw data (clone so we don't mutate original)
      let out = JSON.parse(JSON.stringify(data));

      // If client provided accountId via subscribe or identify earlier,
      // then adjust top-of-book prices per account+symbol rules.
      const acc = ws.engineAccount || null;

      // background lazy load: try to load if accountId present but engineAccount missing
      if (!acc && ws.accountId && !ws._engineAccountLoading) {
        ws._engineAccountLoading = true;
        // don't await here, sync in background and it will affect future ticks
        EngineSync.syncAccount(ws.accountId)
          .then(() => {
            const loaded = tradeEngine.accounts.get(String(ws.accountId)) || null;
            if (loaded) {
              DBG("lazy-loaded account for client", id, ws.accountId);
              ws.engineAccount = loaded;
            }
          })
          .catch(() => {})
          .finally(() => {
            ws._engineAccountLoading = false;
          });
      }

      let appliedThisClient = false;
      let skipReason = null;

      if (!Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) {
        skipReason = { reason: "bad_prices", bestBidRaw, bestAskRaw };
      } else {
        // try to fetch symbol object from engine
        const sym = isSilverSymbol(symbol)
          ? findSymbolInEngine("SILVER") || findSymbolInEngine("XAGUSD")
          : findSymbolInEngine(symbol);
        if (!sym) {
          skipReason = { reason: "symbol_missing_in_engine", symbol, engineSymbolCount: tradeEngine.symbols?.size ?? 0 };
        } else {
          const accountForPrice = acc && acc.spread_enabled !== false ? acc : null;

          // try engine.formatPrice (if exists)
          let formatted = null;
          if (!isSilverSymbol(symbol) && typeof tradeEngine.formatPrice === "function") {
            try {
              const maybe = tradeEngine.formatPrice(accountForPrice, sym, bestBid, bestAsk);
              if (maybe && typeof maybe.bid === "number" && typeof maybe.ask === "number" && Number.isFinite(maybe.bid) && Number.isFinite(maybe.ask)) {
                formatted = { bid: maybe.bid, ask: maybe.ask, src: "engine.formatPrice" };
              } else {
                DBG("formatPrice returned invalid structure", symbol, maybe);
              }
            } catch (err) {
              DBG("formatPrice threw", symbol, err && err.message ? err.message : err);
            }
          }

          // fallback simple formatting
          if (!formatted) {
            const spread = typeof sym.spread === "number" ? sym.spread : 0;
            const spreadMode =
              typeof sym.spread_mode === "string"
                ? sym.spread_mode.trim().toUpperCase()
                : "ADD_ON";
            const silverQuote = isSilverSymbol(symbol);
            const tick = silverQuote
              ? 0.00001
              : typeof sym.tickSize === "number"
              ? sym.tickSize
              : 0;
            const prec = silverQuote
              ? 5
              : typeof sym.pricePrecision === "number"
              ? sym.pricePrecision
              : undefined;

            let pbid = bestBid;
            let pask = bestAsk;

            if (accountForPrice && spread > 0) {
              const half = spread / 2;
              if (spreadMode === "FIXED" && Number.isFinite(pbid) && Number.isFinite(pask)) {
                const mid = (pbid + pask) / 2;
                pbid = mid - half;
                pask = mid + half;
              } else {
                pbid = pbid - half;
                pask = pask + half;
              }
            }

            // enforce tick & precision: bid down, ask up
            pbid = applyTickAndPrecision(pbid, tick, prec, true);
            pask = applyTickAndPrecision(pask, tick, prec, false);

            formatted = { bid: pbid, ask: pask, src: "fallback" };
          }

          // finally validate formatted
          if (
            formatted &&
            typeof formatted.bid === "number" &&
            typeof formatted.ask === "number" &&
            Number.isFinite(formatted.bid) &&
            Number.isFinite(formatted.ask)
          ) {
            // replace top-of-book in out clone
            if (out.bids && out.bids[0]) out.bids[0].price = formatted.bid;
            if (out.asks && out.asks[0]) out.asks[0].price = formatted.ask;
            appliedThisClient = true;
            // verbose per-client log if enabled
            if (DBG_VERBOSE && shouldLogClientSymbol(id, symbol)) {
              INFO(`client ${id} -> spread applied for ${symbol} (account=${ws.accountId}) src=${formatted.src} bid:${bestBidRaw}→${formatted.bid} ask:${bestAskRaw}→${formatted.ask}`);
            }
          } else {
            skipReason = { reason: "formatted_invalid", symbol, formatted };
          }
        }
      }

      // send message
      const msg = JSON.stringify({ type: "orderbook", market, data: out });
      ws.send(msg);

      if (appliedThisClient) appliedCount++;
      else {
        rawCount++;
        // If verbose mode on, log reason for not applying (throttled)
        if (DBG_VERBOSE && shouldLogClientSymbol(id, symbol)) {
          INFO(`client ${id} -> spread NOT applied for ${symbol}`, skipReason || { reason: "unknown" });
        }
      }
    } catch (err) {
      ERROR("[WS SEND ERROR] orderbook ->", err && err.message ? err.message : err);
    }
  } // end clients loop

  // summary log (throttled)
  if (shouldLogForSymbol(symbol)) {
    INFO(`tick ${symbol} feed -> bestBid=${bestBidRaw} bestAsk=${bestAskRaw} applied=${appliedCount} raw=${rawCount} engineSymbols=${tradeEngine.symbols?.size ?? 0} engineAccounts=${tradeEngine.accounts?.size ?? 0}`);
    // If appliedCount === 0, provide extra hints immediately (helpful root-cause)
    if (appliedCount === 0) {
      // Common reasons: symbol missing, accounts missing, spread disabled, bad prices
      const symExists = !!findSymbolInEngine(symbol);
      INFO("tick analysis hint:", {
        symbol,
        symExists,
        symLoaded: symExists ? "yes" : "no",
        accountCount: tradeEngine.accounts?.size ?? 0,
        recommend: symExists ? "check account.spread_enabled or formatPrice" : "load symbols into tradeEngine at bootstrap (tradeEngine.symbols)"
      });
    }
  }
}

// ========================
// FEED PRICE TO TRADE ENGINE
// ========================
async function resolveEngineSymbol(raw) {
  const normalized = normalizeSymbol(raw);
  const stripped = normalized.startsWith("FX")
    ? normalized.replace(/^FX/, "")
    : normalized;

  const candidates = instrumentAliases(stripped);
  if (stripped === "GOLD") candidates.push("XAUUSD");
  if (stripped === "SILVER") candidates.push("XAGUSD");

  for (const candidate of candidates) {
    // Prefer the key that actually exists in the engine map.
    for (const a of instrumentAliases(candidate)) {
      if (tradeEngine?.symbols?.has(a)) return a;
    }
    if (findSymbolInEngine(candidate)) {
      // Return the engine's stored code when possible.
      const hit = findSymbolInEngine(candidate);
      for (const [k, v] of tradeEngine.symbols.entries()) {
        if (v === hit) return normalizeSymbol(k);
      }
      return candidate;
    }
  }

  try {
    const instrument = await findInstrumentByAnySymbol(normalized);
    const code = normalizeSymbol(instrument?.code);
    if (code && findSymbolInEngine(code)) return code;
  } catch (err) {
    DBG("resolveEngineSymbol failed", normalized, err && err.message ? err.message : err);
  }

  return stripped;
}

async function feedEnginePrice(data) {
  const raw =
    data?.code ||
    data?.symbol ||
    data?.s ||
    data?.instrument ||
    data?.instrument_code;

  const symbol = await resolveEngineSymbol(raw);

  const bestBid = data?.bids?.[0]?.price;
  const bestAsk = data?.asks?.[0]?.price;

  const bid = safeNum(bestBid);
  const ask = safeNum(bestAsk);

  DBG("onTick feed ->", symbol, "bid", bid, "ask", ask);

  try {
    if (symbol && typeof tradeEngine.onTick === "function") {
      tradeEngine.onTick(symbol, bid, ask);
    } else {
      DBG("tradeEngine.onTick missing");
    }
  } catch (err) {
    ERROR("[ENGINE] onTick error", err && err.message ? err.message : err);
  }
}

// ========================
// ALLTICK DATA HANDLERS
// ========================
wsCrypto.on("data", (d) => {
  broadcastData("crypto", d);
  feedEnginePrice(d);
  // AllTick metals use code GOLD; UI often watches XAUUSD — mirror both keys.
  const code = normalizeSymbol(d?.code || d?.symbol || "");
  if (code === "GOLD") {
    broadcastData("crypto", { ...d, code: "XAUUSD" });
    broadcastData("metal", { ...d, code: "GOLD" });
    broadcastData("metal", { ...d, code: "XAUUSD" });
  } else if (code === "XAUUSD") {
    broadcastData("crypto", { ...d, code: "GOLD" });
    broadcastData("metal", { ...d, code: "GOLD" });
    broadcastData("metal", { ...d, code: "XAUUSD" });
  }
});

wsStock.on("data", (d) => {
  broadcastData("stock", d);
  feedEnginePrice(d);
});

// ========================
// ENGINE -> REDIS PUB on local engineEvents
// (so single-engine or local engine emits get propagated to other workers)
// ========================
function publishEngineEvent(eventType, payload) {
  const wrapper = JSON.stringify({
    eventType,
    payload,
    ts: Date.now(),
    senderId: INSTANCE_ID,
  });
  redisPub.publish(REDIS_CHANNEL, wrapper).catch((err) => {
    DBG("[ALLTICK-MGR][REDIS] publish error", err && err.message ? err.message : err);
  });
}

const forwardableEvents = [
  "LIVE_ACCOUNT",
  "LIVE_POSITION",
  "LIVE_POSITION_CLOSED",
  "LIVE_PENDING",
  "LIVE_PENDING_EXECUTE",
  "LIVE_PENDING_CANCEL",
  "LIVE_PENDING_EXECUTE_FAILED",
  "LIVE_PENDING_MODIFY",
];

forwardableEvents.forEach((ev) => {
  engineEvents.on(ev, (payload) => {
    try {
      DBG("engineEvents", ev, "->", payload?.accountId ?? payload?.orderId ?? "?");
      forwardEventToLocalClients(ev, payload);
      publishEngineEvent(ev, payload);
    } catch (err) {
      ERROR(`[ENGINE] publish ${ev} error`, err && err.message ? err.message : err);
    }
  });
});

// ========================
// REDIS SUBSCRIBER -> forward to relevant local clients
// ========================
redisSub.on("message", (channel, message) => {
  if (channel !== REDIS_CHANNEL) return;
  let obj;
  try {
    obj = JSON.parse(message);
  } catch (err) {
    ERROR("[ALLTICK-MGR][REDIS] invalid message", err && err.message ? err.message : err);
    return;
  }

  const { eventType, payload, senderId } = obj;
  if (!eventType || !payload) return;
  if (senderId && senderId === INSTANCE_ID) return;

  DBG("redisSub message ->", eventType, payload?.accountId ?? payload?.orderId ?? null);
  forwardEventToLocalClients(eventType, payload);
});

// ========================
// CLIENT MESSAGE HANDLER
// ========================
export async function handleClientMessage(clientWs, msg) {
  try {
    const data = JSON.parse(msg);
    ensureClientSubs(clientWs.clientId);
    const subs = clientSubscriptions.get(clientWs.clientId);
    if (!subs) return;

    DBG("client message", clientWs.clientId, data.type || "<unknown>");

    // JOIN route (market/account)
    if (data.type === "join" && data.route) {
      const route = String(data.route).toLowerCase();
      if (route === "market" || route === "account") {
        clientWs.routes.add(route);
        try {
          clientWs.send(JSON.stringify({ status: "joined", route }));
        } catch {}
      }
      return;
    }

    // LEAVE
    if (data.type === "leave" && data.route) {
      const route = String(data.route).toLowerCase();
      if (route === "market" || route === "account") {
        clientWs.routes.delete(route);
        try {
          clientWs.send(JSON.stringify({ status: "left", route }));
        } catch {}
      }
      return;
    }

    // MARKET subscribe (supports inline accountId)
    if (data.type === "subscribe") {
      const market = normalizeMarket(data.market);
      const feedMarket = normalizeFeedMarket(market);
      const symbol = normalizeSymbol(data.symbol);
      const providerSymbol = await resolveInstrumentProviderCode(data.symbol);
      const subscribeSymbols = Array.from(
        new Set([providerSymbol, symbol].map(normalizeProviderCode).filter(Boolean)),
      );

      if (!market || !symbol || subscribeSymbols.length === 0) {
        try {
          clientWs.send(JSON.stringify({ status: "error", error: "invalid market or symbol" }));
        } catch {}
        return;
      }

      // ensure client is registered for market route (auto-join)
      if (!clientWs.routes || !clientWs.routes.has("market")) {
        clientWs.routes = clientWs.routes || new Set();
        clientWs.routes.add("market");
      }

      // attach account directly if provided in subscribe payload
      if (data.accountId) {
        const accountId = String(data.accountId);
        clientWs.accountId = accountId;

        // try to resolve engine account now (await if loader available)
        let acc = tradeEngine.accounts && tradeEngine.accounts.get(accountId);
        if (!acc) {
          try {
            acc = await ensureEngineAccount(accountId);
          } catch {}
        }
        clientWs.engineAccount = acc || null;

        ensureAccountSet(accountId);
        accountIdMap.get(accountId).add(clientWs.clientId);

        INFO(`client ${clientWs.clientId} subscribed with account ${accountId} engineAccount=${clientWs.engineAccount ? "loaded" : "missing"}`);
      }

      subs.add(makeKey(market, symbol));
      subs.add(makeKey(feedMarket, symbol));
      for (const subSymbol of subscribeSymbols) {
        subs.add(makeKey(market, subSymbol));
        subs.add(makeKey(feedMarket, subSymbol));
      }

      // Upstream: only resolved provider code (case-sensitive). Looping
      // SILVER after Silver overwrites and breaks AllTick (ret 600).
      if (feedMarket === "crypto") {
        wsCrypto.subscribe(symbol, 5, providerSymbol);
      }
      if (feedMarket === "stock") {
        wsStock.subscribe(symbol, 5, providerSymbol);
      }

      // Silver may arrive via metal/stock UI market; keep Yahoo fallback available.
      if (feedMarket === "crypto" || subscribeSymbols.some(isSilverSymbol)) {
        startSilverFallbackIfNeeded(subscribeSymbols);
      }

      // Last price seed: HighLow → kline → trade-tick (app code + provider).
      // Provider aliases like USTEC/DE30/BTCUSD often fail on AllTick REST.
      let seed = null;
      try {
        seed = await resolveSeedQuote(symbol);
      } catch (err) {
        DBG("resolveSeedQuote failed", symbol, err && err.message ? err.message : err);
      }

      if (!seed && feedMarket === "crypto" && subscribeSymbols.some(isSilverSymbol)) {
        try {
          const silver = silverFallbackLast || (await fetchSilverFallbackQuote());
          if (silver?.close > 0) {
            seed = {
              bid: silver.close,
              ask: silver.close,
              dayOpen: silver.open ?? null,
              dayHigh: silver.high ?? null,
              dayLow: silver.low ?? null,
              dayClose: silver.close,
            };
          }
        } catch (err) {
          DBG("Silver fallback OHLC failed", err && err.message ? err.message : err);
        }
      }

      // Prefer last engine tick; fall back to seed bid/ask/dayClose when market is closed.
      let lastBid = null;
      let lastAsk = null;
      for (const subSymbol of subscribeSymbols) {
        const eng =
          (isSilverSymbol(subSymbol)
            ? findSymbolInEngine("SILVER") || findSymbolInEngine("XAGUSD")
            : findSymbolInEngine(subSymbol)) || findSymbolInEngine(symbol);
        const bid = safeNum(eng?.bid ?? eng?.rawBid);
        const ask = safeNum(eng?.ask ?? eng?.rawAsk);
        if (Number.isFinite(bid) && bid > 0) lastBid = bid;
        if (Number.isFinite(ask) && ask > 0) lastAsk = ask;
        if (lastBid != null && lastAsk != null) break;
      }
      const seedBid = safeNum(seed?.bid);
      const seedAsk = safeNum(seed?.ask);
      const seedClose = safeNum(seed?.dayClose);
      if (lastBid == null && Number.isFinite(seedBid) && seedBid > 0) lastBid = seedBid;
      if (lastAsk == null && Number.isFinite(seedAsk) && seedAsk > 0) lastAsk = seedAsk;
      if (lastBid == null && Number.isFinite(seedClose) && seedClose > 0) lastBid = seedClose;
      if (lastAsk == null && Number.isFinite(seedClose) && seedClose > 0) lastAsk = seedClose;

      try {
        clientWs.send(
          JSON.stringify({
            status: "subscribed",
            symbol,
            providerSymbol,
            subscribeSymbols,
            accountId: clientWs.accountId || null,
            dayOpen: seed?.dayOpen ?? null,
            dayHigh: seed?.dayHigh ?? null,
            dayLow: seed?.dayLow ?? null,
            dayClose: seed?.dayClose ?? null,
            previousClose: seed?.previousClose ?? seed?.dayClose ?? null,
            bid: lastBid ?? seed?.bid ?? null,
            ask: lastAsk ?? seed?.ask ?? null,
            lastBid,
            lastAsk,
          }),
        );
      } catch (err) {
        ERROR("[WS SEND ERROR] subscribe ack ->", err && err.message ? err.message : err);
      }
      return;
    }

    // MARKET unsubscribe
    if (data.type === "unsubscribe") {
      if (!clientWs.routes.has("market")) return;
      const market = normalizeMarket(data.market);
      const feedMarket = normalizeFeedMarket(market);
      const symbol = normalizeSymbol(data.symbol);
      subs.delete(makeKey(market, symbol));
      subs.delete(makeKey(feedMarket, symbol));
      if (isSilverSymbol(symbol)) {
        subs.delete(makeKey(market, "SILVER"));
        subs.delete(makeKey(market, "XAGUSD"));
        subs.delete(makeKey(feedMarket, "SILVER"));
        subs.delete(makeKey(feedMarket, "XAGUSD"));
      }
      try {
        clientWs.send(JSON.stringify({ status: "unsubscribed", symbol }));
      } catch (err) {
        ERROR("[WS SEND ERROR] unsubscribe ack ->", err && err.message ? err.message : err);
      }
      return;
    }

    // ACCOUNT identify -> register + snapshot pending orders + positions + account
    if (data.type === "identify" && data.accountId) {
      if (!clientWs.routes.has("account")) {
        clientWs.routes.add("account");
      }

      const accountId = String(data.accountId);
      clientWs.accountId = accountId;

      // Always refresh from DB so deposits/trades show on web even if engine RAM was stale.
      let acc = null;
      try {
        acc = await ensureEngineAccount(accountId, { forceRefresh: true });
      } catch {}
      clientWs.engineAccount = acc || null;

      ensureAccountSet(accountId);
      accountIdMap.get(accountId).add(clientWs.clientId);

      DBG("client identified", clientWs.clientId, "accountId", accountId, "subscribers:", accountIdMap.get(accountId).size);

      try {
        clientWs.send(JSON.stringify({ status: "identified", accountId: clientWs.accountId, engineAccount: clientWs.engineAccount ? "loaded" : "missing" }));
      } catch (err) {
        ERROR("[WS SEND ERROR] identify ack ->", err && err.message ? err.message : err);
      }

      // pendingOrders snapshot
      try {
        const account = tradeEngine.accounts.get(accountId);
        if (account?.pendingOrders && account.pendingOrders.size > 0) {
          DBG("sending pendingOrders snapshot", account.pendingOrders.size, "to", clientWs.clientId);
          for (const order of account.pendingOrders.values()) {
            try {
              clientWs.send(JSON.stringify({ type: "live_pending", data: order }));
            } catch (err) {
              ERROR("[WS SEND ERROR] live_pending snapshot ->", err && err.message ? err.message : err);
            }
          }
        } else {
          DBG("no pendingOrders to snapshot for", accountId);
        }
      } catch {}

      // positions snapshot (applies spread when possible)
      try {
        const account = tradeEngine.accounts.get(accountId);
        if (account?.positions && account.positions.size > 0) {
          DBG("sending positions snapshot", account.positions.size, "to", clientWs.clientId);
          for (const pos of account.positions.values()) {
            try {
              // Always prefer live engine bid/ask — never freeze on openPrice
              // just because spread is off (that made Trade screen look stuck).
              let currentPriceToSend = pos.openPrice;
              let sym = null;
              try {
                sym = findSymbolInEngine(pos.symbol);
                const latestBid = Number(sym?.bid || sym?.rawBid || 0);
                const latestAsk = Number(sym?.ask || sym?.rawAsk || 0);
                if (sym && latestBid > 0 && latestAsk > 0) {
                  let pbid = latestBid;
                  let pask = latestAsk;
                  const useSpread =
                    clientWs.engineAccount &&
                    clientWs.engineAccount.spread_enabled !== false;
                  if (useSpread) {
                    const spread = typeof sym.spread === "number" ? sym.spread : 0;
                    const spreadMode =
                      typeof sym.spread_mode === "string"
                        ? sym.spread_mode.trim().toUpperCase()
                        : "ADD_ON";
                    const tick = typeof sym.tickSize === "number" ? sym.tickSize : 0;
                    const prec =
                      typeof sym.pricePrecision === "number"
                        ? sym.pricePrecision
                        : undefined;

                    if (spread > 0) {
                      const half = spread / 2;
                      if (
                        spreadMode === "FIXED" &&
                        Number.isFinite(pbid) &&
                        Number.isFinite(pask)
                      ) {
                        const mid = (pbid + pask) / 2;
                        pbid = mid - half;
                        pask = mid + half;
                      } else {
                        pbid = pbid - half;
                        pask = pask + half;
                      }
                    }
                    pbid = applyTickAndPrecision(pbid, tick, prec, true);
                    pask = applyTickAndPrecision(pask, tick, prec, false);
                  }
                  currentPriceToSend = pos.side === "BUY" ? pbid : pask;
                }
              } catch {
                currentPriceToSend = pos.openPrice;
              }

              const payload = {
                accountId,
                positionId: pos.positionId,
                ticket: pos.ticket,
                volume: pos.volume,
                openTime: pos.openTime || Date.now(),
                symbol: pos.symbol,
                side: pos.side,
                openPrice: pos.openPrice,
                currentPrice: currentPriceToSend,
                floatingPnL: Number((pos.floatingPnL || 0).toFixed(2)),
                contractSize: pos.contractSize ?? sym?.contractSize ?? null,
                stopLoss: pos.stopLoss ?? null,
                takeProfit: pos.takeProfit ?? null,
                commission: pos.commission || 0,
                swapPerDay: pos.swapPerDay || 0,
              };
              clientWs.send(JSON.stringify({ type: "live_position", data: payload }));
            } catch (err) {
              ERROR("[WS SEND ERROR] live_position snapshot ->", err && err.message ? err.message : err);
            }
          }
        } else {
          DBG("no positions to snapshot for", accountId);
        }
      } catch {}

      // account snapshot
      try {
        const account = tradeEngine.accounts.get(accountId);
        if (account) {
          const accPayload = {
            accountId,
            balance: Number(account.balance?.toFixed ? account.balance.toFixed(2) : account.balance),
            equity: Number(account.equity?.toFixed ? account.equity.toFixed(2) : account.equity),
            bonusBalance: Number(
              account.bonus_balance?.toFixed
                ? account.bonus_balance.toFixed(2)
                : account.bonus_balance || 0,
            ),
            bonusLive: Number(
              account.bonus_live?.toFixed
                ? account.bonus_live.toFixed(2)
                : account.bonus_live || 0,
            ),
            bonusPercent: Number(
              account.bonus_percent?.toFixed
                ? account.bonus_percent.toFixed(2)
                : account.bonus_percent || 0,
            ),
            usedMargin: Number(account.usedMargin?.toFixed ? account.usedMargin.toFixed(2) : account.usedMargin),
            freeMargin: Number(account.freeMargin?.toFixed ? account.freeMargin.toFixed(2) : account.freeMargin),
          };
          clientWs.send(JSON.stringify({ type: "live_account", data: accPayload }));
          DBG("sent account snapshot to", clientWs.clientId, accPayload);
        } else {
          DBG("no account object found in tradeEngine for", accountId);
        }
      } catch (err) {
        ERROR("[ALLTICK-MGR] error sending account snapshot", err && err.message ? err.message : err);
      }

      return;
    }
  } catch (err) {
    ERROR("[WS CLIENT] Invalid message", err && err.message ? err.message : err);
    try {
      clientWs.send(JSON.stringify({ status: "error", error: "Invalid JSON" }));
    } catch {}
  }
}

// ========================
// end of file
// ========================
