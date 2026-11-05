import { clientPositionReportService } from "../services/clientPosition.service.js";

/** GET /trade-admin/client-positions?from=&to=&accountType=live|demo|all */
export async function adminClientPositionReport(req, res) {
  try {
    // The report must only ever cover this admin's own broker.
    if (!req.brokerId) {
      return res.status(403).json({
        success: false,
        message: "Broker scope required for the client position report",
      });
    }
    const data = await clientPositionReportService({
      brokerId: req.brokerId,
      from: req.query.from,
      to: req.query.to,
      accountType: req.query.accountType,
    });
    return res.json({ success: true, data });
  } catch (error) {
    const status = /invalid/i.test(error?.message || "") ? 400 : 500;
    return res.status(status).json({
      success: false,
      message: error?.message || "Failed to build client position report",
    });
  }
}
