import { Router } from "express";
import { searchPublicBrokersController } from "../../controllers/publicBroker.controller.js";

const router = Router();

/** GET /api/v1/brokers/public?q=fp — MT5 Find broker (no auth) */
router.get("/public", searchPublicBrokersController);

export default router;