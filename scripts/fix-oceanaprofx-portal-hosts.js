/**
 * Wire Oceana Pro FX broker portal hosts + membership so Oceanaprofx-Web-Portal
 * signups attach to OCEANAPROFX (not BLACKOS / FPTrade default).
 */
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

const OCEANA_BROKER_ID = "6addfa64c27bf05cb0606932";
const OCEANA_ADMIN_EMAIL = "admin@oceanaprofx.com";

const PORTAL_HOSTS = [
  "user.oceanaprofx.com",
  "www.oceanaprofx.com",
  "oceanaprofx.com",
  // localhost is multi-brand in dev — portals send portalBrokerCode instead
];

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const broker = await db.collection("brokers").findOne({
  _id: new mongoose.Types.ObjectId(OCEANA_BROKER_ID),
});
if (!broker) throw new Error("OCEANAPROFX broker not found");

await db.collection("brokers").updateOne(
  { _id: broker._id },
  { $set: { portalHosts: PORTAL_HOSTS, updatedAt: new Date() } }
);
console.log("Updated OCEANAPROFX portalHosts:", PORTAL_HOSTS);

// Ensure admin@oceanaprofx.com has BROKER_ADMIN membership on Oceana broker
const admin = await db.collection("users").findOne({
  email: OCEANA_ADMIN_EMAIL,
});
if (!admin) {
  console.warn("Admin user not found:", OCEANA_ADMIN_EMAIL);
} else {
  const existing = await db.collection("brokermemberships").findOne({
    brokerId: broker._id,
    userId: admin._id,
  });
  if (existing) {
    console.log("Membership already exists", String(existing._id), existing.role, existing.status);
    if (existing.status !== "ACTIVE" || existing.role !== "BROKER_ADMIN") {
      await db.collection("brokermemberships").updateOne(
        { _id: existing._id },
        {
          $set: {
            role: "BROKER_ADMIN",
            status: "ACTIVE",
            updatedAt: new Date(),
          },
        }
      );
      console.log("Membership activated/updated");
    }
  } else {
    // Copy permission set from an existing broker admin membership
    const template = await db.collection("brokermemberships").findOne({
      role: "BROKER_ADMIN",
      status: "ACTIVE",
    });
    const permissions = template?.permissions || [
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
    const ins = await db.collection("brokermemberships").insertOne({
      brokerId: broker._id,
      userId: admin._id,
      role: "BROKER_ADMIN",
      permissions,
      status: "ACTIVE",
      invitedBy: null,
      acceptedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log("Created membership", String(ins.insertedId));
  }

  // Keep user.brokerId pointing at Oceana
  if (String(admin.brokerId || "") !== String(broker._id)) {
    await db.collection("users").updateOne(
      { _id: admin._id },
      { $set: { brokerId: broker._id } }
    );
    console.log("Admin user.brokerId set to OCEANAPROFX");
  }
}

// Heal recent users that signed up from localhost / ocean hosts but landed on BLACKOS
const blackosId = new mongoose.Types.ObjectId("6addeab085e0293ea500b651");
const healFilter = {
  userType: "USER",
  brokerId: blackosId,
  $or: [
    { signup_ip: { $exists: true } },
    // no reliable host stored on user — heal by recent window is risky.
  ],
};
// Don't mass-heal all BLACKOS users. Only report orphans with no clear host.
const recentWrong = await db
  .collection("users")
  .find({
    userType: "USER",
    brokerId: blackosId,
    createdAt: { $gte: new Date(Date.now() - 48 * 60 * 60 * 1000) },
  })
  .project({ email: 1, name: 1, createdAt: 1, brokerId: 1 })
  .sort({ createdAt: -1 })
  .limit(20)
  .toArray();
console.log(
  "Recent BLACKOS users (last 48h) — manually move Oceana test signups if needed:",
  recentWrong.map((u) => ({
    email: u.email,
    name: u.name,
    createdAt: u.createdAt,
  }))
);

const verify = await db.collection("brokers").findOne(
  { _id: broker._id },
  { projection: { code: 1, portalHosts: 1, displayName: 1 } }
);
console.log("VERIFY", verify);

await mongoose.disconnect();
process.exit(0);
