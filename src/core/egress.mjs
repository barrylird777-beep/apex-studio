import { now } from "./id.mjs";

export class EgressPolicy {
  constructor(options = {}) {
    this.defaultAllow = options.defaultAllow === true;
    this.allowedHosts = new Set(options.allowedHosts ?? String(process.env.APEX_SEX_ALLOWED_HOSTS ?? "").split(",").map(x=>x.trim()).filter(Boolean));
    this.audit = [];
  }

  check(target, { action = "request" } = {}) {
    const url = String(target);
    let host = "";
    try { host = new URL(url).hostname; } catch { host = ""; }
    const allowed = host
      ? (this.allowedHosts.has(host) || this.defaultAllow)
      : false;
    this.audit.push({ target: url, host, action, allowed, at: now() });
    if (!allowed) throw new Error("Egress denied by policy: " + (host || "invalid target"));
    return true;
  }

  listAudit() { return this.audit.map(entry => ({ ...entry })); }
  allowHost(host) { this.allowedHosts.add(String(host)); return this; }
  denyHost(host) { this.allowedHosts.delete(String(host)); return this; }
}
