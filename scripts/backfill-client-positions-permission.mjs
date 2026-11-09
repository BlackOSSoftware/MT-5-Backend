import mongoose from "mongoose";
import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
await mongoose.connect(process.env.MONGO_URI);
const r = await mongoose.connection.db
  .collection("brokermemberships")
  .updateMany(
    { status: "ACTIVE", permissions: { $ne: "reports.client_positions" } },
    { $addToSet: { permissions: "reports.client_positions" } },
  );
console.log("matched:", r.matchedCount, "modified:", r.modifiedCount);
await mongoose.disconnect();
