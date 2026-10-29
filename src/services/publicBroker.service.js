import Broker from "../models/Broker.model.js";
import { BROKER_STATUS } from "../constants/brokerPermissions.js";

/** Internal platform stub — never show in MT5 broker finder. */
const HIDDEN_CODES = new Set(["DEFAULT"]);

function toPublicBroker(doc) {
  return {
    id: String(doc._id),
    code: doc.code || "",
    displayName: doc.displayName || doc.code || "",
    legalName: doc.legalName || "",
    logoUrl: doc.branding?.logoUrl || "",
    primaryColor: doc.branding?.primaryColor || "#0066FF",
    portalHosts: Array.isArray(doc.portalHosts) ? doc.portalHosts : [],
  };
}

function matchesQuery(broker, q) {
  if (!q) return true;
  const hay = [
    broker.displayName,
    broker.legalName,
    broker.code,
    ...(broker.portalHosts || []),
  ]
    .join(" ")
    .toLowerCase();
  // "fp trade" / "fptrades" / "ocean" style tokens — sab match hone chahiye
  const tokens = q
    .toLowerCase()
    .split(/[\s_-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return true;
  return tokens.every((t) => hay.includes(t) || hay.replace(/\s+/g, "").includes(t));
}

/**
 * Public broker list for MT5 "Find broker" search.
 * Auth nahi — sirf ACTIVE brokers, DEFAULT exclude.
 */
export async function searchPublicBrokersService({ q = "" } = {}) {
  const query = String(q || "").trim();
  const rows = await Broker.find({ status: BROKER_STATUS.ACTIVE })
    .select("code displayName legalName branding portalHosts status")
    .sort({ displayName: 1 })
    .lean();

  return rows
    .filter((b) => !HIDDEN_CODES.has(String(b.code || "").toUpperCase()))
    .map(toPublicBroker)
    .filter((b) => matchesQuery(b, query));
}
