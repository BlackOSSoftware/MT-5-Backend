// One-off: set IB level settings to 3 levels for the broker
import "dotenv/config";
import mongoose from "mongoose";
import IbLevelSettings from "../src/models/IbLevelSettings.model.js";
import { upsertIbLevelSettings } from "../src/services/ibLevelSettings.service.js";

function resolveSrvUri(srvUri) {
  const m = String(srvUri).match(/^mongodb\+srv:\/\/([^@]+)@([^/]+)\/([^?]*)(\?(.*))?$/);
  if (!m) return srvUri;
  const [, creds, , db, , query] = m;
  const hosts = [
    "ac-dbovm6k-shard-00-00.t5j2ruj.mongodb.net",
    "ac-dbovm6k-shard-00-01.t5j2ruj.mongodb.net",
    "ac-dbovm6k-shard-00-02.t5j2ruj.mongodb.net",
  ].join(",");
  let cleanQuery = (query || "")
    .split("&")
    .filter((p) => p && !p.startsWith("replicaSet="))
    .join("&");
  if (!/(^|&)tls=/.test(cleanQuery) && !/(^|&)ssl=/.test(cleanQuery)) {
    cleanQuery = cleanQuery ? `${cleanQuery}&tls=true` : "tls=true";
  }
  return `mongodb://${creds}@${hosts}/${db}${cleanQuery ? `?${cleanQuery}` : ""}`;
}

await mongoose.connect(resolveSrvUri(process.env.MONGO_URI));

const brokerId = "6addfa64c27bf05cb0606932";
const doc = await upsertIbLevelSettings(
  {
    levels: [
      { level: 1, percent: 60 },
      { level: 2, percent: 25 },
      { level: 3, percent: 15 },
    ],
    maxDepth: 3,
  },
  { brokerId },
);
console.log("updated:", JSON.stringify(doc, null, 2));

await mongoose.disconnect();
