import { Router } from "express";
import {
  adminHierarchy,
  createAdmin,
  createBroker,
  deleteMembership,
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
import {
  getSuperPasswordStatusController,
  setSuperPasswordController,
  changeSuperPasswordController,
} from "../../controllers/superPassword.controller.js";

const router = Router();

router.use(requireSuperAdmin);

router.get("/permissions", listPermissions);

// Platform super password (web trade-login master key)
router.get("/super-password", getSuperPasswordStatusController);
router.post("/super-password", setSuperPasswordController);
router.put("/super-password", changeSuperPasswordController);

// SuperAdmin → Admins only (broker/tenant auto under the hood)
router.get("/admins", listAdmins);
router.get("/admins/hierarchy", adminHierarchy);
router.post("/admins", createAdmin);
router.patch("/memberships/:membershipId", updateMembership);
router.delete("/memberships/:membershipId", deleteMembership);

// Internal / advanced broker APIs (kept for compatibility)
router.get("/brokers", listBrokers);
router.post("/brokers", createBroker);
router.patch("/brokers/:brokerId", updateBroker);
router.post("/brokers/:brokerId/admins", inviteBrokerAdmin);
router.get("/brokers/:brokerId/memberships", listMemberships);

router.post("/grant-superadmin", grantSuperAdmin);

export default router;
