import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const users = await db
  .collection("users")
  .find({ brokerId: { $ne: null } })
  .project({ _id: 1, brokerId: 1 })
  .toArray();
const byId = new Map(users.map((u) => [String(u._id), u.brokerId]));

const orphans = await db
  .collection("accounts")
  .find({ $or: [{ brokerId: null }, { brokerId: { $exists: false } }] })
  .project({ _id: 1, user_id: 1 })
  .toArray();

const ops = [];
for (const a of orphans) {
  const bid = byId.get(String(a.user_id));
  if (!bid) continue;
  ops.push({
    updateOne: {
      filter: { _id: a._id },
      update: { $set: { brokerId: bid } },
    },
  });
}

let modified = 0;
if (ops.length) {
  const r = await db.collection("accounts").bulkWrite(ops, { ordered: false });
  modified = r.modifiedCount || 0;
}

console.log({ orphans: orphans.length, ops: ops.length, modified });
await mongoose.disconnect();
