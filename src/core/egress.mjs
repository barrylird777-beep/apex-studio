import dns from "node:dns/promises";
import net from "node:net";
import { now } from "./id.mjs";

function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return false;
  const [a,b] = p;
  return a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (!net.isIPv6(ip)) return true;
  const normalized = ip.toLowerCase();
  return normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:");
}

function normalizeHost(host) {
  return String(host ?? "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
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
    this.requireAllowlist = options.requireAllowlist === true;
    this.allowedProtocols = new Set((options.allowedProtocols ?? ["http:", "https:"]).map(String));
  }

  async check(target, { action = "request", requireAllowlist = this.requireAllowlist, allowedProtocols = this.allowedProtocols } = {}) {
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
    return true;
  }

  #audit(target, action, allowed, reason) {
    this.audit.push({
      target,
      host: (() => { try { return new URL(target).hostname; } catch { return ""; } })(),
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
