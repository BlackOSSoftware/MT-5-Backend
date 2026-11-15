import { Router } from "express";
import {
  brokerAdminAuth,
  requireBrokerPermission,
} from "../../middlewares/brokerAuth.middleware.js";
import { MEMBERSHIP_ROLES } from "../../constants/brokerPermissions.js";
import {
  deleteBrokerStaff,
  inviteBrokerStaff,
  listBrokerStaff,
  updateBrokerStaff,
} from "../../controllers/brokerStaff.controller.js";
import { listPermissions } from "../../controllers/platformBroker.controller.js";

const router = Router();

// Only top-level Broker Admins manage staff — Sub-Admins cannot create
// admins or other sub-admins (privilege-escalation guard).
function requireBrokerAdminRole(req, res, next) {
  if (req.isSuperAdmin) return next();
  if (req.membership?.role !== MEMBERSHIP_ROLES.BROKER_ADMIN) {
    return res.status(403).json({
      success: false,
      message: "Only admins can manage sub-admins",
    });
  }
  return next();
}

router.use(
  brokerAdminAuth,
  requireBrokerPermission("admins.manage"),
  requireBrokerAdminRole,
);

router.get("/permissions", listPermissions);
router.get("/", listBrokerStaff);
router.post("/", inviteBrokerStaff);
router.patch("/:membershipId", updateBrokerStaff);
router.delete("/:membershipId", deleteBrokerStaff);

export default router;
