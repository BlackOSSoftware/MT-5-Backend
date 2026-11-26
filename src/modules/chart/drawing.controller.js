import {
  clearDrawings,
  listDrawings,
  removeDrawing,
  replaceDrawings,
  upsertDrawing,
} from "./drawing.service.js";

function scope(req) {
  return {
    userId: req.account?.userId,
    accountId: req.account?.accountId,
  };
}

export async function getDrawingsController(req, res) {
  try {
    const { userId, accountId } = scope(req);
    if (!userId || !accountId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const symbol = String(req.query?.symbol || "").trim();
    const timeframe = String(req.query?.timeframe || "M5").trim();
    if (!symbol) {
      return res.status(400).json({ status: "error", message: "symbol is required" });
    }
    const data = await listDrawings({ userId, accountId, symbol, timeframe });
    return res.json({ status: "success", data });
  } catch (err) {
    console.error("[CHART] get drawings failed:", err?.message);
    return res.status(500).json({ status: "error", message: err?.message || "Failed to load drawings" });
  }
}

/** Bulk replace (debounced autosave from client). */
export async function putDrawingsController(req, res) {
  try {
    const { userId, accountId } = scope(req);
    if (!userId || !accountId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const symbol = String(req.body?.symbol || req.query?.symbol || "").trim();
    const timeframe = String(req.body?.timeframe || req.query?.timeframe || "M5").trim();
    if (!symbol) {
      return res.status(400).json({ status: "error", message: "symbol is required" });
    }
    const data = await replaceDrawings({
      userId,
      accountId,
      symbol,
      timeframe,
      drawings: req.body?.drawings,
    });
    return res.json({ status: "success", data });
  } catch (err) {
    console.error("[CHART] put drawings failed:", err?.message);
    return res.status(500).json({ status: "error", message: err?.message || "Failed to save drawings" });
  }
}

export async function postDrawingController(req, res) {
  try {
    const { userId, accountId } = scope(req);
    if (!userId || !accountId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const symbol = String(req.body?.symbol || "").trim();
    const timeframe = String(req.body?.timeframe || "M5").trim();
    const drawing = req.body?.drawing ?? req.body;
    if (!symbol) {
      return res.status(400).json({ status: "error", message: "symbol is required" });
    }
    const data = await upsertDrawing({ userId, accountId, symbol, timeframe, drawing });
    return res.status(201).json({ status: "success", data });
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500) console.error("[CHART] post drawing failed:", err?.message);
    return res.status(status).json({ status: "error", message: err?.message || "Failed to create drawing" });
  }
}

export async function putDrawingByIdController(req, res) {
  try {
    const { userId, accountId } = scope(req);
    if (!userId || !accountId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const symbol = String(req.body?.symbol || req.query?.symbol || "").trim();
    const timeframe = String(req.body?.timeframe || req.query?.timeframe || "M5").trim();
    const drawing = { ...(req.body?.drawing ?? req.body), id: req.params.id };
    if (!symbol) {
      return res.status(400).json({ status: "error", message: "symbol is required" });
    }
    const data = await upsertDrawing({ userId, accountId, symbol, timeframe, drawing });
    return res.json({ status: "success", data });
  } catch (err) {
    const status = Number(err?.status) || 500;
    return res.status(status).json({ status: "error", message: err?.message || "Failed to update drawing" });
  }
}

export async function deleteDrawingByIdController(req, res) {
  try {
    const { userId, accountId } = scope(req);
    if (!userId || !accountId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const symbol = String(req.query?.symbol || "").trim();
    const timeframe = String(req.query?.timeframe || "M5").trim();
    if (!symbol) {
      return res.status(400).json({ status: "error", message: "symbol is required" });
    }
    const data = await removeDrawing({
      userId,
      accountId,
      symbol,
      timeframe,
      id: req.params.id,
    });
    return res.json({ status: "success", data });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err?.message || "Failed to delete drawing" });
  }
}

export async function deleteDrawingsController(req, res) {
  try {
    const { userId, accountId } = scope(req);
    if (!userId || !accountId) {
      return res.status(401).json({ status: "error", message: "Unauthorized" });
    }
    const symbol = String(req.query?.symbol || req.body?.symbol || "").trim();
    const timeframe = req.query?.timeframe || req.body?.timeframe || undefined;
    if (!symbol) {
      return res.status(400).json({ status: "error", message: "symbol is required" });
    }
    const data = await clearDrawings({ userId, accountId, symbol, timeframe });
    return res.json({ status: "success", data });
  } catch (err) {
    return res.status(500).json({ status: "error", message: err?.message || "Failed to clear drawings" });
  }
}
