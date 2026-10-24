import mongoose from "mongoose";

export const TRADE_DELETE_KINDS = Object.freeze(["LIVE", "CLOSED", "PENDING"]);

export function normalizeTradeDeleteKind(kind) {
  const raw = String(kind || "")
    .trim()
    .toUpperCase();
  if (raw === "OPEN" || raw === "LIVE" || raw === "POSITION") return "LIVE";
  if (raw === "CLOSED" || raw === "CLOSE") return "CLOSED";
  if (raw === "PENDING" || raw === "ORDER") return "PENDING";
  throw new Error("Invalid kind. Allowed: LIVE, CLOSED, PENDING");
}

export function normalizeTradeDeleteTarget(body = {}) {
  const kind = normalizeTradeDeleteKind(body.kind);
  const accountId = body.accountId ? String(body.accountId).trim() : "";
  const userId = body.userId ? String(body.userId).trim() : "";
  const tradeId = body.tradeId ? String(body.tradeId).trim() : "";
  const positionId = body.positionId ? String(body.positionId).trim() : "";
  const orderId = body.orderId ? String(body.orderId).trim() : "";

  if (!accountId || !userId) {
    throw new Error("accountId and userId are required");
  }
  if (!mongoose.isValidObjectId(accountId) || !mongoose.isValidObjectId(userId)) {
    throw new Error("Invalid accountId or userId");
  }

  if (kind === "PENDING") {
    if (!orderId) throw new Error("orderId is required for PENDING delete/restore");
  } else if (kind === "LIVE") {
    if (!positionId && !tradeId) {
      throw new Error("positionId or tradeId is required for LIVE delete/restore");
    }
  } else if (!tradeId && !positionId) {
    throw new Error("tradeId or positionId is required for CLOSED delete/restore");
  }

  if (tradeId && !mongoose.isValidObjectId(tradeId)) {
    throw new Error("Invalid tradeId");
  }

  return {
    kind,
    accountId,
    userId,
    tradeId: tradeId || undefined,
    positionId: positionId || undefined,
    orderId: orderId || undefined,
  };
}

/**
 * Soft-delete must NOT touch account balance.
 * Changing balance would tip off the user that a trade was removed.
 * Live / pending / closed all return 0.
 */
export function computeDeleteBalanceDelta(_kind, _realizedPnL = 0) {
  return 0;
}

/** Restore also leaves balance untouched (delete never adjusted it). */
export function computeRestoreBalanceDelta(_storedDeleteDelta = 0) {
  return 0;
}
