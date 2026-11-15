/** Broker Admin ke assignable rights */
export const BROKER_PERMISSIONS = [
  "users.read",
  "users.create",
  "users.update",
  "kyc.review",
  "finance.deposit.read",
  "finance.deposit.approve",
  "finance.deposit.reject",
  "finance.withdrawal.read",
  "finance.withdrawal.approve",
  "finance.withdrawal.reject",
  "finance.transactions.read",
  "finance.wallet.adjust",
  "finance.payment_methods.manage",
  "plans.manage",
  "trading.positions.read",
  "trading.intervene",
  "settings.bonus",
  "settings.referral",
  "settings.slippage",
  "settings.risk",
  "conversion.manage",
  "notifications.send",
  "inquiry.manage",
  "activity.read",
  "instruments.manage",
  "admins.manage",
  "reports.export",
  "reports.client_positions",
];

/** Full rights — naya Broker Admin default */
export const ALL_BROKER_PERMISSIONS = [...BROKER_PERMISSIONS];

export const PLATFORM_ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
};

export const MEMBERSHIP_ROLES = {
  BROKER_ADMIN: "BROKER_ADMIN",
  BROKER_STAFF: "BROKER_STAFF",
  SUB_ADMIN: "SUB_ADMIN",
};

export const MEMBERSHIP_STATUS = {
  INVITED: "INVITED",
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
  DELETED: "DELETED",
};

export const BROKER_STATUS = {
  ACTIVE: "ACTIVE",
  SUSPENDED: "SUSPENDED",
};
