// ✅ MUST BE FIRST LINE (ESM + dotenv FIX)
import "dotenv/config";

import http from "node:http";
import app from "./app.js";

import { connectDB } from "./config/database.js";
import { startMarketCron } from "./jobs/market.cron.js";
import { startSwapCron } from "./jobs/swap.cron.js";
import { attachMarketWS } from "./ws/market.js";
import { MarketSchedule } from "./models/MarketSchedule.model.js";
import { marketService } from "./services/market.service.js";

// 🔥 TRADE ENGINE
import { bootstrapEngine, tradeEngine } from "./trade-engine/bootstrap.js";
import { startEngineSyncBus } from "./trade-engine/EngineSyncBus.js";
import Account from "./models/Account.model.js";
import Instrument from "./models/Instrument.model.js";
import BonusSetting from "./models/BonusSetting.model.js";

const PORT = Number(process.env.PORT || 4000);

console.log("ENV CHECK:", {
  JWT_SECRET: Boolean(process.env.JWT_SECRET),
  ACCOUNT_JWT_SECRET: Boolean(process.env.ACCOUNT_JWT_SECRET),
});

async function warmMarketStatus(symbols) {
  try {
    const schedules = await MarketSchedule.find({}).select("segment").lean();
    const segmentSet = new Set();

    for (const s of schedules) {
      if (s?.segment) segmentSet.add(String(s.segment));
    }
    for (const sym of symbols) {
      if (sym?.segment) segmentSet.add(String(sym.segment));
    }

    for (const seg of segmentSet) {
      const res = await marketService.refreshMarketStatus(seg);
      if (res?.data) {
        tradeEngine.setMarketStatus(res.data.segment, res.data);
      }
    }

    console.log("[MARKET] status warmed:", Array.from(segmentSet));
  } catch (err) {
    console.error("[MARKET] status warmup failed:", err?.message || err);
  }
}

async function bootstrapTradeEngine() {
  try {
    const bonusSetting = await BonusSetting.findOne({ key: "GLOBAL" }).lean();
    const bonusEnabled =
      bonusSetting?.bonus_enabled !== undefined
        ? Boolean(bonusSetting.bonus_enabled)
        : true;
    const defaultBonusPercent = Number(
      bonusSetting?.default_bonus_percent || 0,
    );

    if (typeof tradeEngine.setBonusSettings === "function") {
      tradeEngine.setBonusSettings({
        bonus_enabled: bonusEnabled,
        default_bonus_percent: defaultBonusPercent,
      });
    }
  } catch (err) {
    console.warn("[BONUS] settings preload failed:", err?.message || err);
  }

  console.log("[BOOTSTRAP] loading accounts + symbols...");
  const accounts = await Account.find(
    { status: "active" },
    {
      balance: 1,
      leverage: 1,
      user_id: 1,
      commission_per_lot: 1,
      swap_charge: 1,
      spread_enabled: 1,
      bonus_balance: 1,
      bonus_percent_override: 1,
    },
  ).lean();

  const symbols = await Instrument.find(
    { isTradeable: true },
    {
      code: 1,
      segment: 1,
      contractSize: 1,
      maxLeverage: 1,
      spread: 1,
      spread_mode: 1,
      tickSize: 1,
      pricePrecision: 1,
    },
  ).lean();

  console.log(
    `[BOOTSTRAP] accounts=${accounts.length} symbols=${symbols.length} — starting engine (ticket backfill may take a while)`,
  );

  await bootstrapEngine({
    accounts,
    symbols,
  });

  console.log("[TRADE ENGINE] RAM READY");

  startEngineSyncBus();
  await warmMarketStatus(symbols);
}

async function start() {
  await connectDB();
  console.log("MongoDB connected");

  // Start HTTP ASAP so auth/login works even while engine backfill runs.
  const server = http.createServer(app);
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  attachMarketWS(server);

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} already in use. Stop the other backend (or kill the process on :${PORT}) and restart once.`,
      );
      process.exit(1);
    }
    console.error("HTTP server error:", err);
    process.exit(1);
  });

  await new Promise((resolve) => {
    server.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log(`WebSocket Market WS at ws://localhost:${PORT}/ws/market`);
      startMarketCron();
      startSwapCron();
      resolve();
    });
  });

  // Heavy trade-engine bootstrap after API is already accepting requests.
  bootstrapTradeEngine().catch((err) => {
    console.error("[BOOTSTRAP] trade engine failed:", err?.message || err);
  });
}

start().catch((err) => {
  console.error("Startup error:", err);
  process.exit(1);
});
