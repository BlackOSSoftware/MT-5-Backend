// Isolated engine test — NO DB writes.
// ledgerQueue.enqueue is patched to capture payloads instead of hitting Mongo.
// ENGINE_SYNC_BUS_ENABLED=0 disables Redis fanout.

process.env.ENGINE_SYNC_BUS_ENABLED = "0";

// Import bootstrap FIRST — same order as server.js — to avoid the
// Engine -> LedgerQueue -> EngineSyncBus -> bootstrap circular crash.
await import("./src/trade-engine/bootstrap.js");

const { Engine } = await import("./src/trade-engine/Engine.js");
const { AccountState } = await import("./src/trade-engine/AccountState.js");
const { Position } = await import("./src/trade-engine/Position.js");
const { ledgerQueue } = await import("./src/trade-engine/LedgerQueue.js");

// --- Patch ledger: capture instead of DB ---
const ledgerCalls = [];
ledgerQueue.enqueue = (type, payload) => {
  ledgerCalls.push({ type, payload });
};

function makeEngine() {
  const engine = new Engine();
  // XAUUSD symbol — NO market status set => real market is "closed"
  engine.symbols.set("XAUUSD", {
    code: "XAUUSD",
    bid: 4000,
    ask: 4000.5,
    rawBid: 4000,
    rawAsk: 4000.5,
    contractSize: 100,
    digits: 2,
    tickSize: 0.01,
    pricePrecision: 2,
    segment: "forex",
  });
  return engine;
}

function makeAccount(engine, { balance = 120000, brokerId = "broker-1" } = {}) {
  const account = new AccountState({
    accountId: "acc-test-1",
    balance,
    leverage: 100,
    brokerId,
    bonus_balance: 0,
    risk_warning_percent: 70,
    risk_stop_out_percent: 80, // admin setting: Oceana Pro FX stop-out = 80%
  });
  const pos = new Position({
    positionId: "pos-1",
    ticket: 1001,
    accountId: "acc-test-1",
    symbol: "XAUUSD",
    side: "BUY",
    volume: 1,
    openPrice: 4000,
    contractSize: 100,
    leverage: 100,
    stopLoss: null,
    takeProfit: null,
  });
  account.positions.set(pos.positionId, pos);
  engine.accounts.set(account.accountId, account);
  return { account, pos };
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
}

// ============ TEST 1: manual price + stopOut selected, market CLOSED => STOP_OUT ============
console.log("\n[TEST 1] Manual price move + Stop-out checked, market closed -> 83% loss -> STOP_OUT expected");
{
  ledgerCalls.length = 0;
  const engine = makeEngine();
  const { account } = makeAccount(engine);

  // price 4000 -> 3000 : PnL = (3000-4000)*1*100 = -100,000 on 120,000 balance => ~83% loss
  await engine.onTick("XAUUSD", 3000, 3000, {
    brokerId: "broker-1",
    updateGlobal: false,
    trigger: "NONE",
    manual: true,
    stopOut: true,
  });

  check("position force-closed", account.positions.size === 0, `size=${account.positions.size}`);
  check("balance floored at remaining ~20%", account.balance === 20000, `balance=${account.balance}`);
  check("equity recalced", account.equity === 20000, `equity=${account.equity}`);
  const closeCall = ledgerCalls.find((c) => c.type === "TRADE_CLOSE");
  check("TRADE_CLOSE ledger enqueued (captured, not DB)", !!closeCall);
  check("close reason = STOP_OUT", closeCall?.payload?.reason === "STOP_OUT", `reason=${closeCall?.payload?.reason}`);
}

// ============ TEST 2: manual price WITHOUT stopOut => NO stop-out even at 83% loss ============
console.log("\n[TEST 2] Manual price move, stop-out NOT selected -> must NOT liquidate");
{
  ledgerCalls.length = 0;
  const engine = makeEngine();
  const { account } = makeAccount(engine);

  await engine.onTick("XAUUSD", 3000, 3000, {
    brokerId: "broker-1",
    updateGlobal: false,
    trigger: "BOTH",
    manual: true,
    // stopOut NOT set -> risk check skipped for manual events
  });

  check("position still open (no auto stop-out)", account.positions.size === 1, `size=${account.positions.size}`);
  check("balance untouched", account.balance === 120000, `balance=${account.balance}`);
  check("no TRADE_CLOSE enqueued", !ledgerCalls.some((c) => c.type === "TRADE_CLOSE"));
}

// ============ TEST 2b: real tick, market closed => NO stop-out ============
console.log("\n[TEST 2b] Real tick, market closed -> stop-out must NOT fire (gate intact)");
{
  ledgerCalls.length = 0;
  const engine = makeEngine();
  const { account } = makeAccount(engine);

  await engine.onTick("XAUUSD", 3000, 3000, {
    brokerId: "broker-1",
    updateGlobal: false,
    trigger: "BOTH",
    // manual NOT set -> real market rules apply
  });

  check("position still open", account.positions.size === 1, `size=${account.positions.size}`);
  check("balance untouched", account.balance === 120000, `balance=${account.balance}`);
  check("no TRADE_CLOSE enqueued", !ledgerCalls.some((c) => c.type === "TRADE_CLOSE"));
}

// ============ TEST 3: manual SL trigger only ============
console.log("\n[TEST 3] Manual price below SL, trigger=SL -> STOP_LOSS close");
{
  ledgerCalls.length = 0;
  const engine = makeEngine();
  const { account, pos } = makeAccount(engine);
  pos.stopLoss = 3500;

  await engine.onTick("XAUUSD", 3400, 3400, {
    brokerId: "broker-1",
    updateGlobal: false,
    trigger: "SL",
    manual: true,
  });

  check("position closed by SL", account.positions.size === 0, `size=${account.positions.size}`);
  const closeCall = ledgerCalls.find((c) => c.type === "TRADE_CLOSE");
  check("reason = STOP_LOSS", closeCall?.payload?.reason === "STOP_LOSS", `reason=${closeCall?.payload?.reason}`);
}

// ============ TEST 4: broker scoping — other broker untouched ============
console.log("\n[TEST 4] Manual event for broker-1 must not touch broker-2 account");
{
  ledgerCalls.length = 0;
  const engine = makeEngine();
  makeAccount(engine, { brokerId: "broker-1" });
  const other = new AccountState({
    accountId: "acc-test-2",
    balance: 50000,
    leverage: 100,
    brokerId: "broker-2",
    bonus_balance: 0,
  });
  const otherPos = new Position({
    positionId: "pos-2",
    ticket: 2002,
    accountId: "acc-test-2",
    symbol: "XAUUSD",
    side: "SELL",
    volume: 1,
    openPrice: 4000,
    contractSize: 100,
    leverage: 100,
  });
  other.positions.set(otherPos.positionId, otherPos);
  engine.accounts.set(other.accountId, other);

  await engine.onTick("XAUUSD", 3000, 3000, {
    brokerId: "broker-1",
    updateGlobal: false,
    trigger: "BOTH",
    manual: true,
  });

  check("broker-2 position untouched", other.positions.size === 1);
  check("broker-2 balance untouched", other.balance === 50000);
  check("broker-2 floatingPnL not repriced", otherPos.floatingPnL === 0, `pnl=${otherPos.floatingPnL}`);
}

console.log(`\n===== RESULT: ${pass} passed, ${fail} failed =====`);
process.exit(fail > 0 ? 1 : 0);
