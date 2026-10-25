import mongoose from 'mongoose';
import PaymentMethod from '../models/PaymentMethod.model.js';
import cloudinary from '../config/cloudinary.js';
import redis from '../config/redis.js';

/* =======================
   REDIS KEYS
======================= */
const ACTIVE_CACHE_KEY = 'payment_methods:active';
const ALL_CACHE_KEY = 'payment_methods:all';
const CACHE_TTL = 60; // seconds

const activeCacheKey = (brokerId) =>
  brokerId ? `${ACTIVE_CACHE_KEY}:${brokerId}` : ACTIVE_CACHE_KEY;
const allCacheKey = (brokerId) =>
  brokerId ? `${ALL_CACHE_KEY}:${brokerId}` : ALL_CACHE_KEY;

const clearPaymentMethodCache = async (brokerId = null) => {
  const keys = [ACTIVE_CACHE_KEY, ALL_CACHE_KEY];
  if (brokerId) {
    keys.push(activeCacheKey(brokerId), allCacheKey(brokerId));
  }
  await redis.del(...keys);
};

function assertPaymentBrokerOwned(doc, brokerId) {
  if (!brokerId) return;
  if (String(doc?.brokerId || '') !== String(brokerId)) {
    const err = new Error('Payment method not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
}

/* =======================
   CREATE PAYMENT METHOD
======================= */
export async function createPaymentMethodService(userId, body, brokerId = null) {
  const { type } = body;

  if (!type) {
    const err = new Error('Payment method type is required');
    err.code = 'INVALID_INPUT';
    throw err;
  }

  const payload = {
    type,
    title: body.title,
    image_url: body.image_url || '',
    image_public_id: body.image_public_id || '',
    created_by: userId,
    is_active: true,
    brokerId: brokerId || body.brokerId || null,
  };

  const rawCurrency =
    typeof body.conversion_currency === 'string'
      ? body.conversion_currency.trim().toUpperCase()
      : '';
  const rawRate =
    body.conversion_rate !== undefined && body.conversion_rate !== null
      ? Number(body.conversion_rate)
      : null;

  const hasValidRate =
    rawRate !== null && Number.isFinite(rawRate) && rawRate > 0;

  if (type === 'BANK') {
    if (
      !body.bank_name ||
      !body.account_name ||
      !body.account_number
    ) {
      const err = new Error('Bank details are required');
      err.code = 'INVALID_INPUT';
      throw err;
    }

    payload.bank_name = body.bank_name;
    payload.account_name = body.account_name;
    payload.account_number = body.account_number;
    if (body.ifsc) {
      payload.ifsc = String(body.ifsc).trim();
    }

    if (body.swift_code) {
      payload.swift_code = String(body.swift_code).trim();
    }

    if (rawCurrency) {
      payload.conversion_currency = rawCurrency;
    }
    if (hasValidRate) {
      payload.conversion_rate = rawRate;
    }
  }

  if (type === 'UPI') {
    if (!body.upi_id) {
      const err = new Error('UPI id is required');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    payload.upi_id = body.upi_id;

    if (rawCurrency) {
      payload.conversion_currency = rawCurrency;
    }
    if (hasValidRate) {
      payload.conversion_rate = rawRate;
    }
  }

  if (type === 'CRYPTO') {
    if (!body.crypto_network || !body.crypto_address) {
      const err = new Error('Crypto details are required');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    payload.crypto_network = body.crypto_network;
    payload.crypto_address = body.crypto_address;
  }

  if (type === 'INTERNATIONAL') {
    if (!body.international_name || !body.international_email) {
      const err = new Error('International name and email are required');
      err.code = 'INVALID_INPUT';
      throw err;
    }
    payload.international_name = body.international_name;
    payload.international_email = body.international_email;

    if (rawCurrency) {
      payload.conversion_currency = rawCurrency;
    }
    if (hasValidRate) {
      payload.conversion_rate = rawRate;
    }
  }

  const created = await PaymentMethod.create(payload);
  await clearPaymentMethodCache(payload.brokerId);

  return created;
}

/* =======================
   UPDATE PAYMENT METHOD
======================= */
export async function updatePaymentMethodService(id, body, brokerId = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error('Invalid payment method id');
    err.code = 'INVALID_ID';
    throw err;
  }

  const existing = await PaymentMethod.findById(id).lean();
  if (!existing) {
    const err = new Error('Payment method not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  assertPaymentBrokerOwned(existing, brokerId);

  const newImagePublicId =
    typeof body.image_public_id === 'string' && body.image_public_id.length > 0
      ? body.image_public_id
      : '';

  if (
    newImagePublicId &&
    existing.image_public_id &&
    existing.image_public_id !== newImagePublicId
  ) {
    try {
      await cloudinary.uploader.destroy(existing.image_public_id);
    } catch {
      const err = new Error('Failed to delete old payment image');
      err.code = 'CLOUDINARY_DELETE_FAILED';
      throw err;
    }
  }

  const { brokerId: _ignoreBroker, ...safeBody } = body || {};
  const updated = await PaymentMethod.findByIdAndUpdate(
    id,
    { $set: safeBody },
    { new: true }
  ).lean();

  await clearPaymentMethodCache(existing.brokerId || brokerId);
  return updated;
}

/* =======================
   DELETE PAYMENT METHOD
======================= */
export async function deletePaymentMethodService(id, brokerId = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error('Invalid payment method id');
    err.code = 'INVALID_ID';
    throw err;
  }

  const paymentMethod = await PaymentMethod.findById(id).lean();
  if (!paymentMethod) {
    const err = new Error('Payment method not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  assertPaymentBrokerOwned(paymentMethod, brokerId);

  if (paymentMethod.image_public_id) {
    try {
      await cloudinary.uploader.destroy(paymentMethod.image_public_id);
    } catch {
      const err = new Error('Failed to delete payment image');
      err.code = 'CLOUDINARY_DELETE_FAILED';
      throw err;
    }
  }

  await PaymentMethod.deleteOne({ _id: id });
  await clearPaymentMethodCache(paymentMethod.brokerId || brokerId);

  return true;
}

/* =======================
   TOGGLE ACTIVE / INACTIVE
======================= */
export async function togglePaymentMethodService(id, isActive, brokerId = null) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    const err = new Error('Invalid payment method id');
    err.code = 'INVALID_ID';
    throw err;
  }

  const existing = await PaymentMethod.findById(id).lean();
  if (!existing) {
    const err = new Error('Payment method not found');
    err.code = 'NOT_FOUND';
    throw err;
  }
  assertPaymentBrokerOwned(existing, brokerId);

  const activate = Boolean(isActive);

  const updated = await PaymentMethod.findByIdAndUpdate(
    id,
    { $set: { is_active: activate } },
    { new: true }
  ).lean();

  await clearPaymentMethodCache(existing.brokerId || brokerId);
  return updated;
}

/* =======================
   USER → ONLY ACTIVE
======================= */
export async function getActivePaymentMethodsService(brokerId = null) {
  const cacheKey = activeCacheKey(brokerId);
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return cached;
    }
  } catch {
    // redis unavailable, fallback to DB
  }

  const filter = { is_active: true };
  if (brokerId) filter.brokerId = brokerId;

  const data = await PaymentMethod.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  const payload = JSON.stringify(data);

  try {
    await redis.setex(cacheKey, CACHE_TTL, payload);
  } catch {
    // ignore redis failure
  }

  return payload;
}
/* =======================
   ADMIN → ALL
======================= */
export async function getAllPaymentMethodsService(brokerId = null) {
  const cacheKey = allCacheKey(brokerId);
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const filter = {};
  if (brokerId) filter.brokerId = brokerId;

  const data = await PaymentMethod.find(filter)
    .sort({ createdAt: -1 })
    .lean();

  await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(data));
  return data;
}
