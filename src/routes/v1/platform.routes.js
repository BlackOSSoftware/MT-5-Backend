import { Router } from "express";
import {
  createAdmin,
  createBroker,
  grantSuperAdmin,
  inviteBrokerAdmin,
  listAdmins,
  listBrokers,
  listMemberships,
  listPermissions,
  updateBroker,
  updateMembership,
} from "../../controllers/platformBroker.controller.js";
import { requireSuperAdmin } from "../../middlewares/brokerAuth.middleware.js";

const router = Router();

router.use(requireSuperAdmin);

router.get("/permissions", listPermissions);

// SuperAdmin → Admins only (broker/tenant auto under the hood)
router.get("/admins", listAdmins);
router.post("/admins", createAdmin);
router.patch("/memberships/:membershipId", updateMembership);

// Internal / advanced broker APIs (kept for compatibility)
router.get("/brokers", listBrokers);
router.post("/brokers", createBroker);
router.patch("/brokers/:brokerId", updateBroker);
router.post("/brokers/:brokerId/admins", inviteBrokerAdmin);
router.get("/brokers/:brokerId/memberships", listMemberships);

router.post("/grant-superadmin", grantSuperAdmin);

export default router;
