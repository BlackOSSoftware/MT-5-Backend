/**
 * App (Flutter/Android) often uses 32-bit ints for ticket/orderId.
 * Recon tickets started at 4810030000 (> Int32 max 2147483647) so history
 * can fail to parse on app while web (JS Number) still works.
 *
 * Remap all recon trade tickets into a safe int32 range.
 */
import dns from "dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "dotenv/config";
import mongoose from "mongoose";

const RECON_TAG = "RECON_HISTORY_4810033902";
const ACCOUNT_NUMBER = "4810033902";
// Keep well below Int32 max (2147483647)
const SAFE_BASE = 1_820_000_000;

await mongoose.connect(process.env.MONGO_URI);
const db = mongoose.connection.db;

const account = await db.collection("accounts").findOne({ account_number: ACCOUNT_NUMBER });
if (!account) throw new Error("account not found");

const trades = await db
  .collection("trades")
  .find({ accountId: account._id, "metadata.reconTag": RECON_TAG })
  .sort({ closeTime: 1, openTime: 1 })
  .toArray();

console.log("Trades to remap:", trades.length);
console.log(
  "Sample old tickets:",
  trades.slice(0, 3).map((t) => ({
    ticket: t.ticket,
    closeTicket: t.closeTicket,
    openDealTicket: t.openDealTicket,
    closeDealTicket: t.closeDealTicket,
  }))
);

// Ensure SAFE_BASE range is free
const conflict = await db.collection("trades").findOne({
  ticket: { $gte: SAFE_BASE, $lt: SAFE_BASE + trades.length * 2 + 10 },
  "metadata.reconTag": { $ne: RECON_TAG },
});
if (conflict) {
  console.warn("Warning: overlapping ticket range with", conflict.ticket);
}

let i = 0;
for (const t of trades) {
  i += 1;
  const ticket = SAFE_BASE + i;
  const closeTicket = SAFE_BASE + 400_000 + i;
  const openDealTicket = SAFE_BASE + 800_000 + i;
  const closeDealTicket = SAFE_BASE + 1_200_000 + i;

  // All must stay < Int32 max
  for (const n of [ticket, closeTicket, openDealTicket, closeDealTicket]) {
    if (n > 2147483647) throw new Error(`Ticket overflow: ${n}`);
  }

  await db.collection("trades").updateOne(
    { _id: t._id },
    {
      $set: {
        ticket,
        closeTicket,
        openDealTicket,
        closeDealTicket,
        "metadata.ticketRemap": "int32-safe",
        "metadata.prevTicket": t.ticket,
      },
    }
  );
}

const sample = await db
  .collection("trades")
  .find({ accountId: account._id, "metadata.reconTag": RECON_TAG })
  .sort({ closeTime: -1 })
  .limit(3)
  .project({ ticket: 1, closeTicket: 1, openDealTicket: 1, closeDealTicket: 1, realizedPnL: 1 })
  .toArray();

console.log("Done. Sample new tickets:", sample);
await mongoose.disconnect();
process.exit(0);
