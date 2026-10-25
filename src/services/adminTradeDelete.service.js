import mongoose from "mongoose";
import Trade from "../models/Trade.model.js";
import PendingOrder from "../models/PendingOrder.model.js";
import Account from "../models/Account.model.js";
import { tradeEngine } from "../trade-engine/bootstrap.js";
import { applyBalanceDelta } from "./adminTradeEdit.validation.js";
import {
  computeDeleteBalanceDelta,
  computeRestoreBalanceDelta,
  normalizeTradeDeleteTarget,
} from "./adminTradeDelete.validation.js";
import {
  ACTIVITY_ACTIONS,
  ACTOR_TYPES,
  recordActivity,
} from "./activity.service.js";
import { applyBrokerUserIdMatch } from "../utils/brokerScope.js";

async function applyAccountBalance(account, delta) {
  if (!delta) return Number(account.balance) || 0;
  const next = applyBalanceDelta(account.balance, delta);
  account.balance = next;
  await account.save();

  const engineAcc = tradeEngine.accounts.get(String(account._id));
  if (engineAcc) {
    engineAcc.balance = next;
    if (typeof tradeEngine.recalcUsedMargin === "function") {
      tradeEngine.recalcUsedMargin(engineAcc);
    }
  }
  return next;
}

function removeLiveFromEngine(accountId, positionId) {
  const acc = tradeEngine.accounts.get(String(accountId));
  if (!acc?.positions) return;
  if (acc.positions.has(positionId)) {
    acc.positions.delete(positionId);
  } else if (/^\d+$/.test(String(positionId))) {
    const ticket = Number(positionId);
    for (const [id, pos] of acc.positions.entries()) {
      if (Number(pos.ticket) === ticket) {
        acc.positions.delete(id);
        break;
      }
    }
  }
  if (typeof tradeEngine.recalcUsedMargin === "function") {
    tradeEngine.recalcUsedMargin(acc);
  }
}

function removePendingFromEngine(accountId, orderId) {
  const acc = tradeEngine.accounts.get(String(accountId));
  if (!acc?.pendingOrders) return;
  if (acc.pendingOrders.has(orderId)) {
    acc.pendingOrders.delete(orderId);
  } else if (/^\d+$/.test(String(orderId))) {
    const ticket = Number(orderId);
    for (const [id, order] of acc.pendingOrders.entries()) {
      if (Number(order.ticket) === ticket) {
        acc.pendingOrders.delete(id);
        break;
      }
    }
  }
}

async function findTradeForDelete({ kind, accountId, userId, tradeId, positionId }) {
  const filter = {
    accountId: new mongoose.Types.ObjectId(accountId),
    userId: new mongoose.Types.ObjectId(userId),
    isDeleted: { $ne: true },
  };
  if (kind === "LIVE") filter.status = "OPEN";
  if (kind === "CLOSED") filter.status = "CLOSED";
  if (tradeId) filter._id = new mongoose.Types.ObjectId(tradeId);
  if (positionId) filter.positionId = String(positionId);

  const trade = await Trade.findOne(filter);
  if (!trade) throw new Error(`${kind} trade not found`);
  return trade;
}

async function findPendingForDelete({ accountId, userId, orderId }) {
  const filter = {
    accountId: new mongoose.Types.ObjectId(accountId),
    userId: new mongoose.Types.ObjectId(userId),
    status: "PENDING",
    isDeleted: { $ne: true },
    orderId: String(orderId),
  };
  let order = await PendingOrder.findOne(filter);
  if (!order && /^\d+$/.test(String(orderId))) {
    order = await PendingOrder.findOne({
      accountId: filter.accountId,
      userId: filter.userId,
      status: "PENDING",
      isDeleted: { $ne: true },
      ticket: Number(orderId),
    });
  }
  if (!order) throw new Error("Pending order not found");
  return order;
}

export async function adminDeleteTradeService(body = {}, { actorId } = {}) {
  const target = normalizeTradeDeleteTarget(body);

  const account = await Account.findOne({
    _id: target.accountId,
    user_id: target.userId,
  });
  if (!account) throw new Error("Account not found");

  if (target.kind === "PENDING") {
    const order = await findPendingForDelete(target);
    order.isDeleted = true;
    order.deletedAt = new Date();
    order.deletedBy = actorId || null;
    order.deleteBalanceDelta = 0;
    await order.save();
    removePendingFromEngine(order.accountId, order.orderId);

    await recordActivity({
      userId: String(order.userId),
      action: ACTIVITY_ACTIONS.TRADE_DELETED_BY_ADMIN,
      actorId: actorId ? String(actorId) : null,
      actorType: ACTOR_TYPES.ADMIN,
    });

    return {
      kind: "PENDING",
      order,
      balanceDelta: 0,
      balance: account.balance,
    };
  }

  const trade = await findTradeForDelete(target);
  const balanceDelta = computeDeleteBalanceDelta(
    target.kind,
    trade.realizedPnL
  );

  trade.isDeleted = true;
  trade.deletedAt = new Date();
  trade.deletedBy = actorId || null;
  trade.deleteBalanceDelta = balanceDelta;
  await trade.save();

  if (target.kind === "LIVE") {
    removeLiveFromEngine(trade.accountId, trade.positionId);
  }

  const balance = await applyAccountBalance(account, balanceDelta);

  await recordActivity({
    userId: String(trade.userId),
    action: ACTIVITY_ACTIONS.TRADE_DELETED_BY_ADMIN,
    actorId: actorId ? String(actorId) : null,
    actorType: ACTOR_TYPES.ADMIN,
  });

  return {
    kind: target.kind,
    trade,
    balanceDelta,
    balance,
  };
}

export async function adminRestoreTradeService(body = {}, { actorId } = {}) {
  const target = normalizeTradeDeleteTarget(body);

  const account = await Account.findOne({
    _id: target.accountId,
    user_id: target.userId,
  });
  if (!account) throw new Error("Account not found");

  if (target.kind === "PENDING") {
    const filter = {
      accountId: new mongoose.Types.ObjectId(target.accountId),
      userId: new mongoose.Types.ObjectId(target.userId),
      isDeleted: true,
      orderId: String(target.orderId),
    };
    let order = await PendingOrder.findOne(filter);
    if (!order && /^\d+$/.test(String(target.orderId))) {
      order = await PendingOrder.findOne({
        accountId: filter.accountId,
        userId: filter.userId,
        isDeleted: true,
        ticket: Number(target.orderId),
      });
    }
    if (!order) throw new Error("Deleted pending order not found");

    order.isDeleted = false;
    order.deletedAt = null;
    order.deletedBy = null;
    const storedDelta = Number(order.deleteBalanceDelta) || 0;
    order.deleteBalanceDelta = 0;
    await order.save();

    if (order.status === "PENDING") {
      if (!tradeEngine.accounts.get(String(order.accountId))) {
        tradeEngine.loadAccount({
          accountId: String(order.accountId),
          balance: account.balance,
          leverage: account.leverage,
          userId: String(order.userId),
        });
      }
      tradeEngine.loadPendingOrder(order.toObject ? order.toObject() : order);
    }

    await recordActivity({
      userId: String(order.userId),
      action: ACTIVITY_ACTIONS.TRADE_RESTORED_BY_ADMIN,
      actorId: actorId ? String(actorId) : null,
      actorType: ACTOR_TYPES.ADMIN,
    });

    return {
      kind: "PENDING",
      order,
      balanceDelta: computeRestoreBalanceDelta(storedDelta),
      balance: account.balance,
    };
  }

  const filter = {
    accountId: new mongoose.Types.ObjectId(target.accountId),
    userId: new mongoose.Types.ObjectId(target.userId),
    isDeleted: true,
  };
  if (target.kind === "LIVE") filter.status = "OPEN";
  if (target.kind === "CLOSED") filter.status = "CLOSED";
  if (target.tradeId) filter._id = new mongoose.Types.ObjectId(target.tradeId);
  if (target.positionId) filter.positionId = String(target.positionId);

  const trade = await Trade.findOne(filter);
  if (!trade) throw new Error("Deleted trade not found");

  const restoreDelta = computeRestoreBalanceDelta(trade.deleteBalanceDelta);
  trade.isDeleted = false;
  trade.deletedAt = null;
  trade.deletedBy = null;
  trade.deleteBalanceDelta = 0;
  await trade.save();

  const balance = await applyAccountBalance(account, restoreDelta);

  if (target.kind === "LIVE" && trade.status === "OPEN") {
    if (!tradeEngine.accounts.get(String(trade.accountId))) {
      tradeEngine.loadAccount({
        accountId: String(trade.accountId),
        balance: account.balance,
        leverage: account.leverage,
        userId: String(trade.userId),
      });
    }
    tradeEngine.loadOpenPosition(trade.toObject ? trade.toObject() : trade);
  }

  await recordActivity({
    userId: String(trade.userId),
    action: ACTIVITY_ACTIONS.TRADE_RESTORED_BY_ADMIN,
    actorId: actorId ? String(actorId) : null,
    actorType: ACTOR_TYPES.ADMIN,
  });

  return {
    kind: target.kind,
    trade,
    balanceDelta: restoreDelta,
    balance,
  };
}

export async function adminListDeletedTradesService(query = {}) {
  const pageRaw = Number(query.page);
  const limitRaw = Number(query.limit);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 20;
  const skip = (page - 1) * limit;

  const kindFilter = query.kind
    ? String(query.kind).trim().toUpperCase()
    : "ALL";

  const tradeMatch = { isDeleted: true };
  const pendingMatch = { isDeleted: true };

  if (query.userId && mongoose.isValidObjectId(query.userId)) {
    tradeMatch.userId = new mongoose.Types.ObjectId(query.userId);
    pendingMatch.userId = new mongoose.Types.ObjectId(query.userId);
  }
  if (query.accountId && mongoose.isValidObjectId(query.accountId)) {
    tradeMatch.accountId = new mongoose.Types.ObjectId(query.accountId);
    pendingMatch.accountId = new mongoose.Types.ObjectId(query.accountId);
  }
  if (typeof query.symbol === "string" && query.symbol.trim()) {
    const sym = query.symbol.trim().toUpperCase();
    tradeMatch.symbol = sym;
    pendingMatch.symbol = sym;
  }

  if (query.brokerId) {
    await applyBrokerUserIdMatch(tradeMatch, query.brokerId, "userId");
    await applyBrokerUserIdMatch(pendingMatch, query.brokerId, "userId");
  }

  const [trades, pendings] = await Promise.all([
    kindFilter === "PENDING"
      ? []
      : Trade.find({
          ...tradeMatch,
          ...(kindFilter === "LIVE"
            ? { status: "OPEN" }
            : kindFilter === "CLOSED"
              ? { status: "CLOSED" }
              : {}),
        })
          .sort({ deletedAt: -1 })
          .lean(),
    kindFilter === "LIVE" || kindFilter === "CLOSED"
      ? []
      : PendingOrder.find(pendingMatch).sort({ deletedAt: -1 }).lean(),
  ]);

  const mapped = [
    ...trades.map((t) => ({
      ...t,
      kind: t.status === "OPEN" ? "LIVE" : "CLOSED",
      source: "TRADE",
    })),
    ...pendings.map((o) => ({
      ...o,
      kind: "PENDING",
      source: "PENDING",
    })),
  ].sort((a, b) => {
    const ta = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
    const tb = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
    return tb - ta;
  });

  const total = mapped.length;
  const items = mapped.slice(skip, skip + limit);

  // enrich user/account labels
  const userIds = [...new Set(items.map((i) => String(i.userId)).filter(Boolean))];
  const accountIds = [
    ...new Set(items.map((i) => String(i.accountId)).filter(Boolean)),
  ];
  const [users, accounts] = await Promise.all([
    userIds.length
      ? (
          await import("../models/User.model.js")
        ).default
          .find({ _id: { $in: userIds } })
          .select("name email")
          .lean()
      : [],
    accountIds.length
      ? Account.find({ _id: { $in: accountIds } })
          .select("account_number")
          .lean()
      : [],
  ]);
  const userMap = new Map(
    users.map((u) => [String(u._id), { name: u.name || "", email: u.email || "" }])
  );
  const accountMap = new Map(
    accounts.map((a) => [String(a._id), a.account_number || ""])
  );

  const enriched = items.map((row) => {
    const u = userMap.get(String(row.userId));
    return {
      ...row,
      userName: u?.name || "",
      userEmail: u?.email || "",
      accountNumber: accountMap.get(String(row.accountId)) || "",
    };
  });

  return {
    items: enriched,
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}
