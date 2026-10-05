import { log } from "../core/resilience/load-shedder.mjs";

const BSSID_RE = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

function normalizeBssid(value) {
  const bssid = String(value || "").trim().toLowerCase();
  if (!BSSID_RE.test(bssid)) throw new TypeError("Invalid BSSID");
  return bssid;
}

function normalizeAp(ap) {
  const bssid = normalizeBssid(ap?.bssid);
  const ssid = String(ap?.ssid ?? "").trim();
  const rssi = Number(ap?.rssi);
  const channel = Number(ap?.channel);
  if (!Number.isFinite(rssi)) throw new TypeError(`Invalid RSSI for ${bssid}`);
  if (!Number.isInteger(channel) || channel < 1 || channel > 233) {
    throw new TypeError(`Invalid channel for ${bssid}`);
  }
  return { ssid, bssid, rssi, channel };
}

export class RogueApDetector {
  constructor(options = {}) {
    this.trustedWhitelist = new Set(
      (options.trustedBssids || []).map(normalizeBssid)
    );
    this.authorizedSsid = String(options.authorizedSsid || "").trim();
    if (!this.authorizedSsid) throw new TypeError("authorizedSsid is required");
    this.alertHandler = typeof options.alertHandler === "function"
      ? options.alertHandler
      : (threat) => log("warn", "Rogue AP detected", threat);
  }

  trustBssid(bssid) {
    this.trustedWhitelist.add(normalizeBssid(bssid));
  }

  revokeBssid(bssid) {
    this.trustedWhitelist.delete(normalizeBssid(bssid));
  }

  isTrusted(bssid) {
    return this.trustedWhitelist.has(normalizeBssid(bssid));
  }

  /**
   * Audits AP observations supplied by an authorized inventory/telemetry
   * source. This class does not put an interface into monitor mode or
   * capture wireless traffic.
   */
  async auditAirspace(observations = []) {
    if (!Array.isArray(observations)) {
      throw new TypeError("observations must be an array");
    }

    try {
      const discovered = observations.map(normalizeAp);
      const threats = [];

      for (const ap of discovered) {
        if (ap.ssid !== this.authorizedSsid || this.isTrusted(ap.bssid)) continue;

        const threat = {
          type: "UNTRUSTED_AUTHORIZED_SSID",
          severity: "HIGH",
          ssid: ap.ssid,
          suspiciousBssid: ap.bssid,
          signalRssi: ap.rssi,
          channel: ap.channel,
          timestamp: new Date().toISOString()
        };

        threats.push(threat);
        await this.alertHandler(threat);
      }

      const report = {
        scannedCount: discovered.length,
        threats,
        timestamp: new Date().toISOString()
      };

      log("info", "Wireless AP inventory audit complete", {
        scanned_count: report.scannedCount,
        threat_count: threats.length
      });

      return report;
    } catch (error) {
      log("error", "Wireless AP inventory audit failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(
        `AIRSPACE_AUDIT_FAULT: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export default RogueApDetector;

if (import.meta.url === `file://${process.argv[1]}`) {
  const detector = new RogueApDetector({
    authorizedSsid: "Apex_Industrial_Mesh",
    trustedBssids: ["00:11:22:33:44:55"]
  });

  detector.auditAirspace([
    { ssid: "Apex_Industrial_Mesh", bssid: "00:11:22:33:44:55", rssi: -50, channel: 6 },
    { ssid: "Apex_Industrial_Mesh", bssid: "de:ad:be:ef:ca:fe", rssi: -42, channel: 6 }
  ]).then((report) => console.log(JSON.stringify(report, null, 2)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
