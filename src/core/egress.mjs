import dns from "node:dns/promises";
import net from "node:net";
import { now } from "./id.mjs";

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return true;
  const [a, b, c] = p;
  return a === 0 ||
    a === 10 ||
    a === 100 && b >= 64 && b <= 127 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 0 && c === 0 ||
    a === 192 && b === 0 && c === 2 ||
    a === 192 && b === 168 ||
    a === 198 && b === 18 ||
    a === 198 && b === 19 ||
    a === 198 && b === 51 && c === 100 ||
    a === 203 && b === 0 && c === 113 ||
    a >= 224;
}

function mappedIPv4(ip) {
  const normalized = ip.toLowerCase();
  const match = normalized.match(/^::ffff:(?:0:)?(\\d+(?:\\.\\d+){3})$/);
  return match?.[1] ?? null;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase().split("%")[0];
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80:")) return true;
  if (normalized.startsWith("ff")) return true;
  const mapped = mappedIPv4(normalized);
  return mapped ? isPrivateIPv4(mapped) : false;
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}

function normalizeHost(host) {
  return String(host ?? "").trim().toLowerCase().replace(/^\\.+|\\.+$/g, "");
}

function hostAllowed(host, patterns) {
  const normalized = normalizeHost(host);
  return patterns.some(pattern => {
    const p = normalizeHost(pattern);
    if (!p) return false;
    if (p.startsWith("*.")) {
      const suffix = p.slice(1);
      return normalized.endsWith(suffix) && normalized !== suffix.slice(1);
    }
    return normalized === p;
  });
}

function parseAllowlist(value) {
  if (Array.isArray(value)) return value.map(normalizeHost).filter(Boolean);
  return String(value ?? "").split(",").map(normalizeHost).filter(Boolean);
}

export class EgressPolicy {
  constructor(options = {}) {
    this.audit = [];
    this.resolve = options.resolve ?? dns.lookup;
    this.allowedHosts = parseAllowlist(options.allowedHosts ?? process.env.APEX_SEX_ALLOWED_HOSTS);
    this.requireAllowlist = options.requireAllowlist ?? true;
    this.allowedProtocols = new Set((options.allowedProtocols ?? ["https:"]).map(String));
  }

  async check(target, {
    action = "request",
    requireAllowlist = this.requireAllowlist,
    allowedProtocols = this.allowedProtocols
  } = {}) {
    const url = new URL(String(target));

    if (!allowedProtocols.has(url.protocol)) {
      this.#audit(url.href, action, false, "protocol");
      throw new Error("Egress denied: protocol is not permitted");
    }

    if (url.username || url.password) {
      this.#audit(url.href, action, false, "embedded-credentials");
      throw new Error("Egress denied: embedded credentials are not permitted");
    }

    const host = normalizeHost(url.hostname);
    if (!host) {
      this.#audit(url.href, action, false, "empty-host");
      throw new Error("Egress denied: target host is empty");
    }

    if (requireAllowlist && !hostAllowed(host, this.allowedHosts)) {
      this.#audit(url.href, action, false, "host-not-allowlisted");
      throw new Error("Egress denied: target host is not allowlisted");
    }

    const addresses = net.isIP(host)
      ? [host]
      : (await this.resolve(host, { all: true, verbatim: true })).map(x => x.address);

    if (!addresses.length || addresses.some(isPrivateAddress)) {
      this.#audit(url.href, action, false, "non-public-address");
      throw new Error("Egress denied: target is not a public network address");
    }

    this.#audit(url.href, action, true, "allowed");
    return {
      allowed: true,
      hostname: host,
      addresses: [...addresses],
      protocol: url.protocol
    };
  }

  #audit(target, action, allowed, reason) {
    this.audit.push({
      target,
      host: (() => {
        try { return new URL(target).hostname; } catch { return ""; }
      })(),
      action,
      allowed,
      reason,
      at: now()
    });
  }

  listAudit() {
    return this.audit.map(entry => ({ ...entry }));
  }
}
