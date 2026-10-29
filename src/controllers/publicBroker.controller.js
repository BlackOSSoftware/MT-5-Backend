import { searchPublicBrokersService } from "../services/publicBroker.service.js";

export async function searchPublicBrokersController(req, res) {
  try {
    const q = req.query?.q ?? req.query?.search ?? "";
    const data = await searchPublicBrokersService({ q });
    return res.json({ status: "success", data });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      message: err.message || "Broker search failed",
    });
  }
}
