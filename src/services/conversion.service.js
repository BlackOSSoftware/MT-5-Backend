import ConversionRate from "../models/ConversionRate.model.js";

const DEFAULT_RATES = {
  usdtInr: 90,
  btcUsdt: 100000,
};

function round(value, precision = 8) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function rateKeyForBroker(brokerId) {
  if (!brokerId) return "GLOBAL";
  return `BROKER:${String(brokerId)}`;
}

async function getGlobalSeedRates() {
  const global = await ConversionRate.findOne({ key: "GLOBAL" }).lean();
  if (!global) return { ...DEFAULT_RATES };
  return {
    usdtInr: global.usdtInr ?? DEFAULT_RATES.usdtInr,
    btcUsdt: global.btcUsdt ?? DEFAULT_RATES.btcUsdt,
  };
}

/**
 * Per-broker conversion rates. Each broker admin edits their own doc.
 * Missing broker docs are created from GLOBAL (legacy) or defaults — then diverge.
 */
async function getOrCreateRatesDoc(brokerId = null) {
  const key = rateKeyForBroker(brokerId);
  let rates = await ConversionRate.findOne({ key });

  if (!rates && brokerId) {
    rates = await ConversionRate.findOne({ brokerId });
  }

  if (!rates) {
    const seed = brokerId ? await getGlobalSeedRates() : { ...DEFAULT_RATES };
    rates = await ConversionRate.create({
      key,
      brokerId: brokerId || null,
      ...seed,
    });
  }

  return rates;
}

export async function getConversionRatesService(brokerId = null) {
  if (!brokerId) {
    throw new Error("brokerId is required for conversion rates");
  }

  const rates = await getOrCreateRatesDoc(brokerId);

  return {
    usdtInr: rates.usdtInr,
    btcUsdt: rates.btcUsdt,
    brokerId: rates.brokerId ? String(rates.brokerId) : null,
    updatedAt: rates.updatedAt,
  };
}

export async function upsertConversionRatesService({
  usdtInr,
  btcUsdt,
  updatedBy,
  brokerId = null,
}) {
  if (!brokerId) {
    throw new Error("brokerId is required to update conversion rates");
  }

  const setPayload = {};

  if (usdtInr !== undefined) {
    if (typeof usdtInr !== "number" || Number.isNaN(usdtInr) || usdtInr <= 0) {
      throw new Error("usdtInr must be a number greater than 0");
    }
    setPayload.usdtInr = usdtInr;
  }

  if (btcUsdt !== undefined) {
    if (typeof btcUsdt !== "number" || Number.isNaN(btcUsdt) || btcUsdt <= 0) {
      throw new Error("btcUsdt must be a number greater than 0");
    }
    setPayload.btcUsdt = btcUsdt;
  }

  if (!Object.keys(setPayload).length) {
    throw new Error("At least one rate is required (usdtInr or btcUsdt)");
  }

  setPayload.updatedBy = updatedBy || null;
  setPayload.brokerId = brokerId;

  const key = rateKeyForBroker(brokerId);
  const seed = await getGlobalSeedRates();
  const setOnInsertPayload = {
    key,
    ...(setPayload.usdtInr === undefined ? { usdtInr: seed.usdtInr } : {}),
    ...(setPayload.btcUsdt === undefined ? { btcUsdt: seed.btcUsdt } : {}),
  };

  const rates = await ConversionRate.findOneAndUpdate(
    { key },
    { $set: setPayload, $setOnInsert: setOnInsertPayload },
    { upsert: true, new: true },
  );

  return {
    usdtInr: rates.usdtInr,
    btcUsdt: rates.btcUsdt,
    brokerId: rates.brokerId ? String(rates.brokerId) : null,
    updatedAt: rates.updatedAt,
  };
}

function normalizeCurrency(currency) {
  const c = String(currency || "").trim().toUpperCase();
  if (c === "USD") return "USDT";
  return c;
}

export async function convertAmountService({
  amount,
  fromCurrency,
  toCurrency,
  brokerId = null,
}) {
  if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
    throw new Error("amount must be a number greater than 0");
  }

  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  const allowed = new Set(["INR", "USDT", "BTC"]);

  if (!allowed.has(from) || !allowed.has(to)) {
    throw new Error("Supported currencies: INR, USD/USDT, BTC");
  }

  if (from === to) {
    return {
      amount,
      fromCurrency,
      toCurrency,
      convertedAmount: round(amount),
      rates: await getConversionRatesService(brokerId),
    };
  }

  const rates = await getConversionRatesService(brokerId);

  let amountInUsdt;
  if (from === "USDT") amountInUsdt = amount;
  if (from === "INR") amountInUsdt = amount / rates.usdtInr;
  if (from === "BTC") amountInUsdt = amount * rates.btcUsdt;

  let convertedAmount;
  if (to === "USDT") convertedAmount = amountInUsdt;
  if (to === "INR") convertedAmount = amountInUsdt * rates.usdtInr;
  if (to === "BTC") convertedAmount = amountInUsdt / rates.btcUsdt;

  return {
    amount,
    fromCurrency,
    toCurrency,
    convertedAmount: round(convertedAmount),
    intermediateUsdt: round(amountInUsdt),
    rates,
  };
}
