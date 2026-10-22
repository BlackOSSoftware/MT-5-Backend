// Chart ke liye instrument info (AllTick code, REST market, price digits).
// Apna chhota cache - shared instrument service ko nahi chhedta.
import Instrument from "../../models/Instrument.model.js";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // SYMBOL -> { value, expiresAt }

/**
 * AllTick ka asli kline code har symbol ke liye alag field me hai
 * (BTCUSDT -> app code chalta hai, SILVER -> providerCode XAGUSD).
 * Jo code chal gaya woh process lifetime ke liye yaad.
 */
const workingCode = new Map(); // SYMBOL -> code

const providerCode = (v) => String(v || "").replace(/[^A-Za-z0-9]/g, "");

function toInfo(symbol, inst) {
  const segment = String(inst?.segment || "").trim().toLowerCase();
  const digits = Number(inst?.pricePrecision);
  const appCode = String(inst?.code || symbol).toUpperCase();
  const candidates = [
    ...new Set(
      [providerCode(inst?.providerCode), providerCode(appCode)].filter(Boolean),
    ),
  ];
  return {
    symbol: appCode,
    name: inst?.name || "",
    /** Try order: providerCode, phir app code. */
    codes: candidates.length ? candidates : [providerCode(symbol)],
    // Forex / metal / indices / crypto sab AllTick "crypto" REST pe,
    // sirf stocks alag.
    market: segment === "stock" || segment === "stocks" ? "stock" : "crypto",
    digits: Number.isFinite(digits) ? digits : null,
  };
}

/** Symbol (app code ya provider code) -> chart instrument info. */
export async function resolveChartInstrument(symbol) {
  const key = String(symbol || "").toUpperCase();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return withWorking(hit.value);

  const inst = await Instrument.findOne({
    $or: [{ code: key }, { providerCode: providerCode(key) }],
  })
    .select("code name segment providerCode pricePrecision")
    .lean();

  const value = toInfo(key, inst);
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
  return withWorking(value);
}

function withWorking(info) {
  const known = workingCode.get(info.symbol);
  if (!known) return info;
  return { ...info, codes: [known, ...info.codes.filter((c) => c !== known)] };
}

export function rememberWorkingCode(symbol, code) {
  workingCode.set(String(symbol).toUpperCase(), code);
}
