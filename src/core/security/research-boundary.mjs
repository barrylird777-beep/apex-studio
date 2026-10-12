import dns from "node:dns/promises";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const MAX_QUERY_LENGTH = 1000;
const MAX_URL_LENGTH = 2048;

function isPrivateIpv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(ip) {
  const value = ip.toLowerCase();
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe80:");
}

export function validateResearchQuery(value) {
  const query = String(value ?? "").trim();
  if (!query) throw new TypeError("research query is required");
  if (query.length > MAX_QUERY_LENGTH) throw new RangeError("research query exceeds 1000 characters");
  return query;
}

export async function assertSafeResearchUrl(rawUrl) {
  const value = String(rawUrl ?? "").trim();
  if (!value || value.length > MAX_URL_LENGTH) throw new TypeError("research URL is missing or too long");

  let url;
  try { url = new URL(value); } catch { throw new TypeError("research URL is invalid"); }

  if (!["http:", "https:"].includes(url.protocol)) throw new TypeError("research URL must use http or https");
  if (url.username || url.password) throw new TypeError("research URL credentials are not allowed");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("research URL targets a blocked hostname");
  }

  if (/^\d+(?:\.\d+){3}$/.test(hostname) && isPrivateIpv4(hostname)) {
    throw new Error("research URL targets a private or link-local address");
  }
  if (hostname.includes(":") && isPrivateIpv6(hostname)) {
    throw new Error("research URL targets a private or link-local address");
  }

  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length) throw new Error("research hostname did not resolve");

  for (const address of addresses) {
    if (address.family === 4 && isPrivateIpv4(address.address)) {
      throw new Error("research hostname resolves to a private or link-local address");
    }
    if (address.family === 6 && isPrivateIpv6(address.address)) {
      throw new Error("research hostname resolves to a private or link-local address");
    }
  }

  return url.toString();
}
