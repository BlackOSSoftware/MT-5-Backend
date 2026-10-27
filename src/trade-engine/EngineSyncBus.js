// src/trade-engine/EngineSyncBus.js
// Redis pub/sub fanout so DB-driven changes (deposit/withdraw/admin updates) sync to every Node worker.

import redis from "../config/redis.js";
import EngineSync from "./EngineSync.js";
import { tradeEngine } from "./bootstrap.js";

const ENABLED_RAW = String(process.env.ENGINE_SYNC_BUS_ENABLED ?? "1")
  .trim()
  .toLowerCase();
const ENABLED = !["0", "false", "no", "off"].includes(ENABLED_RAW);

const CHANNEL = String(process.env.ENGINE_SYNC_BUS_CHANNEL || "engine:sync");

const INSTANCE_ID = String(
  process.env.ENGINE_SYNC_INSTANCE_ID ||
    `${process.pid}:${Math.random().toString(16).slice(2)}`,
);

let subClient = null;
let started = false;

function publish(type, payload) {
  if (!ENABLED) return;

  const msg = JSON.stringify({
    type,
    payload,
    ts: Date.now(),
    origin: INSTANCE_ID,
  });

  try {
    redis.publish(CHANNEL, msg).catch((err) => {
      console.warn(
        "[ENGINE_SYNC_BUS] publish failed:",
        err?.message || err,
      );
    });
  } catch (err) {
    console.warn("[ENGINE_SYNC_BUS] publish threw:", err?.message || err);
  }
}

export function startEngineSyncBus() {
  if (!ENABLED) {
    console.log("[ENGINE_SYNC_BUS] disabled via ENGINE_SYNC_BUS_ENABLED");
    return;
  }

  if (started) return;
  started = true;

  try {
    subClient = redis.duplicate();
  } catch (err) {
    started = false;
    console.warn(
      "[ENGINE_SYNC_BUS] failed to create subscriber:",
      err?.message || err,
    );
    return;
  }

  subClient.on("error", (err) => {
    console.warn("[ENGINE_SYNC_BUS] subscriber error:", err?.message || err);
  });

  subClient
    .subscribe(CHANNEL)
    .then(() => {
      console.log("[ENGINE_SYNC_BUS] subscribed:", {
        channel: CHANNEL,
        instanceId: INSTANCE_ID,
      });
    })
    .catch((err) => {
      console.warn("[ENGINE_SYNC_BUS] subscribe failed:", err?.message || err);
    });

  subClient.on("message", (channel, message) => {
    if (channel !== CHANNEL) return;

    let obj;
    try {
      obj = JSON.parse(message);
    } catch {
      return;
    }

    if (!obj || obj.origin === INSTANCE_ID) return;

    const { type, payload } = obj;

    try {
      if (type === "ACCOUNT_SNAPSHOT") {
        EngineSync.applyAccountSnapshot(payload);
        return;
      }

      if (type === "ACCOUNT_BALANCE") {
        EngineSync.updateBalance(payload?.accountId, payload?.balance, {
          bonusBalance: payload?.bonusBalance,
        }).catch(() => {});
        return;
      }

      // Another worker closed this position — drop it from local RAM so app/web
      // cannot square-off the same trade twice (double PnL / balance chaos).
      if (type === "POSITION_CLOSED") {
        const accountId = String(payload?.accountId || "");
        const positionId = String(payload?.positionId || "");
        if (accountId && positionId) {
          const acc = tradeEngine.accounts.get(accountId);
          if (acc?.positions?.has?.(positionId)) {
            acc.positions.delete(positionId);
            try {
              acc.recalc?.();
            } catch {
              /* ignore */
            }
          }
        }
        if (payload?.balance != null && accountId) {
          EngineSync.updateBalance(accountId, payload.balance, {
            bonusBalance: payload?.bonusBalance,
          }).catch(() => {});
        }
        return;
      }

      if (type === "ACCOUNT_REMOVE") {
        EngineSync.removeAccount(payload?.accountId);
        return;
      }

      if (type === "SYMBOL_UPSERT") {
        EngineSync.loadSymbolFromInstrument(payload?.instrument || payload);
        return;
      }

      if (type === "SYMBOL_REMOVE") {
        EngineSync.removeInstrumentByCode(payload?.code || payload);
        return;
      }

      if (type === "MARKET_STATUS") {
        const seg = payload?.segment;
        const status = payload?.status;
        if (seg && status) tradeEngine.setMarketStatus(seg, status);
      }

      if (type === "BONUS_SETTINGS") {
        if (typeof tradeEngine.setBonusSettings === "function") {
          tradeEngine.setBonusSettings({
            bonus_enabled: payload?.bonus_enabled,
            default_bonus_percent: payload?.default_bonus_percent,
          });
        }
      }
    } catch (err) {
      console.warn("[ENGINE_SYNC_BUS] handler error:", err?.message || err);
    }
  });
}

export function publishAccountSnapshot(accountDocOrSnapshot) {
  if (!accountDocOrSnapshot) return;

  const accountId =
    accountDocOrSnapshot.accountId ||
    accountDocOrSnapshot._id ||
    accountDocOrSnapshot.id;

  if (!accountId) return;

  publish("ACCOUNT_SNAPSHOT", {
    accountId: String(accountId),
    balance: Number(accountDocOrSnapshot.balance),
    leverage: Number(accountDocOrSnapshot.leverage),
    user_id: accountDocOrSnapshot.user_id,
    userId: accountDocOrSnapshot.userId,
    commission_per_lot: Number(accountDocOrSnapshot.commission_per_lot || 0),
    swap_charge: Number(accountDocOrSnapshot.swap_charge || 0),
    spread_enabled: accountDocOrSnapshot.spread_enabled === true,
    bonus_balance: Number(accountDocOrSnapshot.bonus_balance || 0),
    bonus_percent_override:
      typeof accountDocOrSnapshot.bonus_percent_override === "number"
        ? accountDocOrSnapshot.bonus_percent_override
        : accountDocOrSnapshot.bonus_percent_override === null
          ? null
          : undefined,
    status: accountDocOrSnapshot.status,
    account_type: accountDocOrSnapshot.account_type,
  });
}

export function publishAccountBalance(accountId, balance, bonusBalance) {
  if (!accountId) return;
  publish("ACCOUNT_BALANCE", {
    accountId: String(accountId),
    balance,
    bonusBalance,
  });
}

/** Fanout: remove closed position from every worker's engine RAM. */
export function publishPositionClosed(
  accountId,
  positionId,
  balance,
  bonusBalance,
) {
  if (!accountId || !positionId) return;
  publish("POSITION_CLOSED", {
    accountId: String(accountId),
    positionId: String(positionId),
    ...(balance != null ? { balance: Number(balance) } : {}),
    ...(bonusBalance != null ? { bonusBalance: Number(bonusBalance) } : {}),
  });
}

export function publishAccountRemove(accountId) {
  if (!accountId) return;
  publish("ACCOUNT_REMOVE", {
    accountId: String(accountId),
  });
}

export function publishSymbolUpsert(instrumentDoc) {
  if (!instrumentDoc) return;
  publish("SYMBOL_UPSERT", { instrument: instrumentDoc });
}

export function publishSymbolRemove(code) {
  if (!code) return;
  publish("SYMBOL_REMOVE", { code: String(code).trim().toUpperCase() });
}

export function publishMarketStatus(segment, status) {
  if (!segment || !status) return;
  publish("MARKET_STATUS", { segment: String(segment), status });
}

export function publishBonusSettings(settings) {
  if (!settings) return;
  try {
    if (typeof tradeEngine.setBonusSettings === "function") {
      tradeEngine.setBonusSettings({
        bonus_enabled: settings.bonus_enabled,
        default_bonus_percent: settings.default_bonus_percent,
      });
    }
  } catch (err) {
    console.warn(
      "[ENGINE_SYNC_BUS] local bonus settings update failed:",
      err?.message || err,
    );
  }
  publish("BONUS_SETTINGS", {
    bonus_enabled: settings.bonus_enabled,
    default_bonus_percent: settings.default_bonus_percent,
  });
}
