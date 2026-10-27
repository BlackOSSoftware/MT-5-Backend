import "dotenv/config";
import dns from "dns";
import mongoose from "mongoose";

const DEFAULT_ID = process.env.DEFAULT_BROKER_ID || "6addeab085e0293ea500b651";

async function main() {
  const servers = String(process.env.DNS_SERVERS || "8.8.8.8,1.1.1.1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length) dns.setServers(servers);

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const users = db.collection("users");
  const deposits = db.collection("deposits");
  const withdrawals = db.collection("withdrawals");
  const trades = db.collection("trades");
  const inquiries = db.collection("inquiries");
  const defaultId = new mongoose.Types.ObjectId(DEFAULT_ID);

  const nullUserFilter = {
    userType: "USER",
    $or: [{ brokerId: null }, { brokerId: { $exists: false } }],
  };

  const beforeUsers = await users.countDocuments(nullUserFilter);
  const userHeal = await users.updateMany(nullUserFilter, {
    $set: { brokerId: defaultId },
  });

  // Stamp deposits/withdrawals/trades from user.brokerId
  const userDocs = await users
    .find({ brokerId: { $ne: null } })
    .project({ _id: 1, brokerId: 1, email: 1 })
    .toArray();
  const byId = new Map(userDocs.map((u) => [String(u._id), u.brokerId]));
  const byEmail = new Map(
    userDocs
      .filter((u) => u.email)
      .map((u) => [String(u.email).toLowerCase(), u.brokerId]),
  );

  async function stampCollection(col, userField = "user") {
    const orphans = await col
      .find({ $or: [{ brokerId: null }, { brokerId: { $exists: false } }] })
      .project({ _id: 1, [userField]: 1, email: 1 })
      .toArray();
    let modified = 0;
    const ops = [];
    for (const doc of orphans) {
      let bid = byId.get(String(doc[userField] || ""));
      if (!bid && doc.email) bid = byEmail.get(String(doc.email).toLowerCase());
      if (!bid) continue;
      ops.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { brokerId: bid } },
        },
      });
    }
    if (ops.length) {
      const r = await col.bulkWrite(ops, { ordered: false });
      modified = r.modifiedCount || 0;
    }
    return { orphans: orphans.length, modified };
  }

  const dep = await stampCollection(deposits, "user");
  const wit = await stampCollection(withdrawals, "user");
  const tr = await stampCollection(trades, "userId");
  const inq = await stampCollection(inquiries, "user");

  const fptradeUsers = await users.countDocuments({
    userType: "USER",
    brokerId: defaultId,
  });
  const stillNullUsers = await users.countDocuments(nullUserFilter);
  const stillNullDep = await deposits.countDocuments({
    $or: [{ brokerId: null }, { brokerId: { $exists: false } }],
  });

  console.log(
    JSON.stringify(
      {
        DEFAULT_ID,
        beforeNullUsers: beforeUsers,
        userHeal: userHeal.modifiedCount,
        deposits: dep,
        withdrawals: wit,
        trades: tr,
        inquiries: inq,
        fptradeUsers,
        stillNullUsers,
        stillNullDep,
      },
      null,
      2,
    ),
  );

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
