import { log } from "../core/resilience/load-shedder.mjs";

const BSSID_RE = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;
const MAX_OBSERVATIONS = 500;
const DEFAULT_WINDOW_MS = 30_000;
const DEFAULT_RSSI_SPIKE_DB = 18;

function normalizeBssid(value) {
  const bssid = String(value ?? "").trim().toLowerCase();
  if (!BSSID_RE.test(bssid)) throw new TypeError("Invalid BSSID");
  return bssid;
}

function normalizeCapabilities(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) throw new TypeError("capabilities must be an array");
  return [...new Set(value.map(item => String(item).trim()).filter(Boolean))].sort();
}

function normalizeObservedAt(value) {
  if (value === undefined) return Date.now();
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) throw new TypeError("Invalid observedAt");
  return time;
}

function normalizeAp(ap) {
  if (!ap || typeof ap !== "object" || Array.isArray(ap)) throw new TypeError("Observation must be an object");
  const bssid = normalizeBssid(ap.bssid);
  const ssid = String(ap.ssid ?? "").trim();
  if (!ssid || ssid.length > 32) throw new TypeError(`Invalid SSID for ${bssid}`);
  const rssi = Number(ap.rssi);
  if (!Number.isFinite(rssi) || rssi < -127 || rssi > 0) throw new TypeError(`Invalid RSSI for ${bssid}`);
  const channel = Number(ap.channel);
  if (!Number.isInteger(channel) || channel < 1 || channel > 233) {
    throw new TypeError(`Invalid channel for ${bssid}`);
  }
  return {
    ssid,
    bssid,
    rssi,
    channel,
    capabilities: normalizeCapabilities(ap.capabilities),
    observedAt: normalizeObservedAt(ap.observedAt)
  };
}

function oui(bssid) {
  return bssid.split(":").slice(0, 3).join(":");
}

function capabilitySignature(capabilities) {
  return capabilities.join("|");
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function validateObservationEnvelope(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("request body must be an object");
  }
  const keys = Object.keys(body);
  if (!keys.every(key => key === "observations")) throw new TypeError("Unsupported request field");
  if (!Array.isArray(body.observations)) throw new TypeError("observations must be an array");
  if (body.observations.length > MAX_OBSERVATIONS) {
    throw new TypeError(`observations exceeds maximum of ${MAX_OBSERVATIONS}`);
  }
  const allowed = new Set(["ssid", "bssid", "rssi", "channel", "capabilities", "observedAt"]);
  return body.observations.map(observation => {
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) {
      throw new TypeError("Observation must be an object");
    }
    for (const key of Object.keys(observation)) {
      if (!allowed.has(key)) throw new TypeError(`Unsupported observation field: ${key}`);
    }
    return normalizeAp(observation);
  });
}

export class RogueApDetector {
  constructor(options = {}) {
    this.trustedBssids = new Set((options.trustedBssids || options.trustedWhitelist || []).map(normalizeBssid));
    this.authorizedSsid = String(options.authorizedSsid || "").trim();
    if (!this.authorizedSsid) throw new TypeError("authorizedSsid is required");
    this.flappingWindowMs = Math.max(1000, Number(options.flappingWindowMs || DEFAULT_WINDOW_MS));
    this.rssiSpikeDb = Math.max(1, Number(options.rssiSpikeDb || DEFAULT_RSSI_SPIKE_DB));
    this.rssiBaselines = new Map(
      Object.entries(options.rssiBaselines || {}).map(([ssid, baseline]) => [
        String(ssid),
        { min: Number(baseline.min), max: Number(baseline.max) }
      ])
    );
    this.history = new Map();
    this.alertHandler = typeof options.alertHandler === "function"
      ? options.alertHandler
      : threat => log("warn", "Wireless anomaly observed", threat);
  }

  trustBssid(bssid) {
    this.trustedBssids.add(normalizeBssid(bssid));
  }

  revokeBssid(bssid) {
    this.trustedBssids.delete(normalizeBssid(bssid));
  }

  isTrusted(bssid) {
    return this.trustedBssids.has(normalizeBssid(bssid));
  }

  scoreBssids(observations) {
    const bySsid = new Map();
    for (const ap of observations) {
      if (!bySsid.has(ap.ssid)) bySsid.set(ap.ssid, []);
      bySsid.get(ap.ssid).push(ap);
    }

    const findings = [];
    for (const [ssid, aps] of bySsid) {
      if (ssid !== this.authorizedSsid) continue;

      const current = new Map(aps.map(ap => [ap.bssid, ap]));
      const ouis = new Set(aps.map(ap => oui(ap.bssid)));
      const baseline = this.rssiBaselines.get(ssid);

      if (ouis.size > 1 && aps.length > 1) {
        findings.push({
          type: "BSSID_FLAPPING",
          confidence: clampScore(70 + Math.min(25, (ouis.size - 2) * 10)),
          severity: "HIGH",
          ssid,
          detail: "Distinct vendor OUI blocks were observed for the same authorized SSID in one observation window.",
          bssids: [...current.keys()],
          vendorOuis: [...ouis]
        });
      }

      for (const ap of aps) {
        if (baseline && Number.isFinite(baseline.max) && ap.rssi > baseline.max + this.rssiSpikeDb) {
          findings.push({
            type: "RSSI_ANOMALY",
            confidence: clampScore(75 + Math.min(20, ap.rssi - baseline.max)),
            severity: "HIGH",
            ssid,
            bssid: ap.bssid,
            rssi: ap.rssi,
            baselineMax: baseline.max
          });
        }
      }

      const signatures = new Map();
      for (const ap of aps) {
        const signature = capabilitySignature(ap.capabilities);
        if (!signatures.has(signature)) signatures.set(signature, []);
        signatures.get(signature).push(ap.bssid);
      }
      if (signatures.size > 1 && aps.length > 1) {
        findings.push({
          type: "CLONED_BSSID_SIGNATURE",
          confidence: 82,
          severity: "HIGH",
          ssid,
          signatures: [...signatures.entries()].map(([signature, bssids]) => ({ signature, bssids }))
        });
      }
    }

    return findings;
  }

  evaluateObservations(observations = []) {
    if (!Array.isArray(observations)) throw new TypeError("observations must be an array");
    if (observations.length > MAX_OBSERVATIONS) throw new TypeError(`observations exceeds maximum of ${MAX_OBSERVATIONS}`);
    const discovered = observations.map(normalizeAp);
    const now = Math.max(Date.now(), ...discovered.map(ap => ap.observedAt));
    const windowStart = now - this.flappingWindowMs;

    const recent = [];
    for (const ap of discovered) {
      const list = this.history.get(ap.ssid) || [];
      list.push(ap);
      const retained = list.filter(item => item.observedAt >= windowStart);
      this.history.set(ap.ssid, retained);
      recent.push(...retained);
    }

    const heuristicFindings = this.scoreBssids(recent);
    const threats = [];
    for (const ap of discovered) {
      if (ap.ssid === this.authorizedSsid && !this.isTrusted(ap.bssid)) {
        threats.push({
          type: "UNTRUSTED_AUTHORIZED_SSID",
          confidence: 65,
          severity: "MEDIUM",
          ssid: ap.ssid,
          bssid: ap.bssid,
          rssi: ap.rssi,
          channel: ap.channel,
          vendorOui: oui(ap.bssid)
        });
      }
    }

    for (const finding of heuristicFindings) {
      threats.push(finding);
    }

    const deduped = [...new Map(threats.map(threat => [
      JSON.stringify([threat.type, threat.ssid, threat.bssid, threat.vendorOuis, threat.signatures]),
      threat
    ])).values()];

    return {
      scannedCount: discovered.length,
      threatCount: deduped.length,
      highConfidenceCount: deduped.filter(threat => threat.confidence >= 80).length,
      threats: deduped,
      classification: "behavioral_heuristic",
      telemetryOnly: true,
      timestamp: new Date(now).toISOString()
    };
  }

  async auditAirspace(observations = []) {
    try {
      const report = this.evaluateObservations(observations);
      for (const threat of report.threats) await this.alertHandler(threat);
      log("info", "Wireless behavioral anomaly audit complete", {
        scanned_count: report.scannedCount,
        threat_count: report.threatCount,
        high_confidence_count: report.highConfidenceCount,
        classification: report.classification
      });
      return report;
    } catch (error) {
      log("error", "Wireless behavioral anomaly audit failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`AIRSPACE_AUDIT_FAULT: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export default RogueApDetector;
