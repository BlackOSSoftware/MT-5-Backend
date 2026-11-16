/**
 * Centralized client IP detection + normalization.
 *
 * Trust model:
 *  - Express `trust proxy` is set to private/loopback ranges only, so
 *    `req.ip` is resolved from X-Forwarded-For by walking back to the
 *    first PUBLIC address. Client-supplied spoofed XFF entries sit to the
 *    LEFT of the real client IP and are ignored.
 *  - Cloudflare: `cf-connecting-ip` is only trusted when `cf-ray` is also
 *    present (Cloudflare sets both on every proxied request). Nginx should
 *    strip client-supplied cf-* headers when the origin is not locked to CF.
 */

const IPV4_MAPPED_RE = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;

/** Normalize a raw IP string: strip ::ffff: prefix, brackets, XFF lists. */
export function normalizeIp(ip) {
  if (ip === null || ip === undefined) return null;
  let s = String(ip).trim();
  if (!s) return null;

  // X-Forwarded-For may contain a comma-separated chain — keep the first.
  if (s.includes(",")) s = s.split(",")[0].trim();

  // Strip IPv6 brackets e.g. [::1]
  s = s.replace(/^\[|\]$/g, "");

  const mapped = s.match(IPV4_MAPPED_RE);
  if (mapped) s = mapped[1];

  if (!s || s.length > 45) return null;
  if (!IPV4_RE.test(s) && !IPV6_RE.test(s)) return null;
  return s;
}

/**
 * Resolve the real client IP for a request.
 * Priority: Cloudflare header (when CF-signed) → Express req.ip →
 * X-Real-IP → X-Forwarded-For → socket address.
 */
export function getClientIp(req) {
  if (!req) return null;

  const headers = req.headers || {};

  // Cloudflare sets both headers on every request it proxies.
  const cfIp = normalizeIp(headers["cf-connecting-ip"]);
  const cfRay = headers["cf-ray"];
  if (cfIp && typeof cfRay === "string" && cfRay.trim()) {
    return cfIp;
  }

  // req.ip is already resolved by Express trust proxy (private hops only).
  const fromReq = normalizeIp(req.ip);
  if (fromReq) return fromReq;

  const realIp = normalizeIp(headers["x-real-ip"]);
  if (realIp) return realIp;

  const forwarded = normalizeIp(headers["x-forwarded-for"]);
  if (forwarded) return forwarded;

  return (
    normalizeIp(req.socket?.remoteAddress) ||
    normalizeIp(req.connection?.remoteAddress) ||
    null
  );
}
