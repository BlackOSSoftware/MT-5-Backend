import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const brokers = await db.collection("brokers").find({}).toArray();
console.log(
  "BROKERS",
  brokers.map((b) => ({
    id: String(b._id),
    code: b.code,
    displayName: b.displayName || b.name,
    portalHosts: b.portalHosts,
    status: b.status,
    isDefault: b.isDefault,
  }))
);

const cols = (await db.listCollections().toArray()).map((c) => c.name);
console.log(
  "relevant cols",
  cols.filter((n) => /broker|admin|member|user/i.test(n))
);

for (const col of ["brokeradmins", "broker_admins", "brokerMemberships", "brokermemberships"]) {
  if (!cols.includes(col)) continue;
  const rows = await db.collection(col).find({}).limit(30).toArray();
  console.log(col, rows.length, JSON.stringify(rows.slice(0, 5), null, 2));
}

const admins = await db
  .collection("users")
  .find({
    $or: [
      { userType: { $in: ["ADMIN", "BROKER_ADMIN", "SUPER_ADMIN"] } },
      { email: { $regex: /admin|ocean|fptrade|blackos/i } },
    ],
  })
  .project({ email: 1, userType: 1, brokerId: 1, name: 1, platformRole: 1 })
  .limit(40)
  .toArray();
console.log("USERS/ADMINS", JSON.stringify(admins, null, 2));

console.log("ENV MAP", process.env.SIGNUP_HOST_BROKER_MAP);
console.log("DEFAULT_BROKER_CODE", process.env.DEFAULT_BROKER_CODE);
console.log("DEFAULT_BROKER_ID", process.env.DEFAULT_BROKER_ID);

await mongoose.disconnect();
process.exit(0);
