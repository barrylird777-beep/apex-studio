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

export class EgressPolicy {
  constructor(options = {}) {
    this.audit = [];
    this.resolve = options.resolve ?? dns.lookup;
  }

  async check(target, { action = "request" } = {}) {
    const url = new URL(String(target));
    if (!["http:", "https:"].includes(url.protocol)) {
      this.#audit(url.href, action, false);
      throw new Error("Egress denied: only public HTTP(S) URLs are supported");
    }

    const host = url.hostname;
    const addresses = net.isIP(host)
      ? [host]
      : (await this.resolve(host, { all: true, verbatim: true })).map(x => x.address);

    if (!addresses.length || addresses.some(isPrivateAddress)) {
      this.#audit(url.href, action, false);
      throw new Error("Egress denied: target is not a public network address");
    }

    this.#audit(url.href, action, true);
    return true;
  }

  #audit(target, action, allowed) {
    this.audit.push({ target, host: (() => { try { return new URL(target).hostname; } catch { return ""; } })(), action, allowed, at: now() });
  }

  listAudit() { return this.audit.map(entry => ({ ...entry })); }
}
