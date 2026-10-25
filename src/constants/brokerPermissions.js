/** Broker Admin ke assignable rights */
export const BROKER_PERMISSIONS = [
  "users.read",
  "users.create",
  "users.update",
  "kyc.review",
  "finance.deposit.approve",
  "finance.deposit.reject",
  "finance.withdrawal.approve",
  "finance.withdrawal.reject",
  "finance.payment_methods.manage",
  "plans.manage",
  "trading.positions.read",
  "trading.intervene",
  "settings.bonus",
  "settings.referral",
  "admins.manage",
  "reports.export",
];

/** Full rights — naya Broker Admin default */
export const ALL_BROKER_PERMISSIONS = [...BROKER_PERMISSIONS];

export const PLATFORM_ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
};

export const MEMBERSHIP_ROLES = {
  BROKER_ADMIN: "BROKER_ADMIN",
  BROKER_STAFF: "BROKER_STAFF",
};

export const MEMBERSHIP_STATUS = {
  INVITED: "INVITED",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
};

export const BROKER_STATUS = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
};
