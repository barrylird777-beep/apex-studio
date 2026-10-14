import dns from "node:dns/promises";
import { isIP } from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "metadata.google.internal"]);
const MAX_QUERY_LENGTH = 1000;
const MAX_URL_LENGTH = 2048;

function isPrivateIpv4(ip) {
  const parts = String(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

function ipv6Hextets(ip) {
  let value = String(ip).toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const index = value.lastIndexOf(":");
    const ipv4 = value.slice(index + 1).split(".").map(Number);
    if (ipv4.length !== 4 || ipv4.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    value = value.slice(0, index + 1) + ((ipv4[0] << 8) | ipv4[1]).toString(16) + ":" + ((ipv4[2] << 8) | ipv4[3]).toString(16);
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const parts = [...left, ...Array(missing).fill("0"), ...right].map(part => /^[0-9a-f]{1,4}$/.test(part) ? parseInt(part, 16) : NaN);
  return parts.length === 8 && parts.every(Number.isFinite) ? parts : null;
}

function isPrivateIpv6(ip) {
  const parts = ipv6Hextets(ip);
  if (!parts) return true;
  const [a, b, c, d, e, f, g, h] = parts;
  if (parts.every(part => part === 0) || (parts.slice(0, 7).every(part => part === 0) && h === 1)) return true;
  if ((a & 0xfe00) === 0xfc00 || (a & 0xffc0) === 0xfe80 ||
      (a & 0xff00) === 0xff00 || (a & 0xffc0) === 0xfec0) return true;
  // IPv4-mapped and deprecated IPv4-compatible IPv6 addresses must inherit IPv4 restrictions.
  if (parts.slice(0, 5).every(part => part === 0) && (f === 0xffff || f === 0)) {
    return isPrivateIpv4([
      g >> 8, g & 255, h >> 8, h & 255
    ].join("."));
  }
  // Reject transition/documentation ranges that can tunnel or misrepresent destinations.
  if (a === 0x2001 && b === 0x0db8) return true;
  if (a === 0x2002) return isPrivateIpv4([b >> 8, b & 255, c >> 8, c & 255].join("."));
  if (a === 0x0064 && b === 0xff9b && c === 0 && d === 0 && e === 0 && f === 0) {
    return true;
  }
  return false;
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

  const ipVersion = isIP(hostname);
  if ((ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && isPrivateIpv6(hostname))) {
    throw new Error("research URL targets a private, loopback, reserved, or link-local address");
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
