const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

function clean(value, max = 256) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizeMac(value) {
  const mac = clean(value, 32).toUpperCase().replace(/-/g, ":");
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) ? mac : "";
}

function normalizeObservation(input = {}) {
  const ssid = clean(input.ssid, 128);
  const bssid = normalizeMac(input.bssid);
  const channel = Number(input.channel);
  const rssi = Number(input.rssi);
  const ageMs = Number(input.ageMs ?? 0);

  if (!ssid || !bssid) throw new Error("ssid and a valid bssid are required");
  if (!Number.isFinite(channel) || channel < 1 || channel > 233) throw new Error("channel must be between 1 and 233");
  if (!Number.isFinite(rssi) || rssi < -120 || rssi > 0) throw new Error("rssi must be between -120 and 0 dBm");
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > DEFAULT_MAX_AGE_MS) throw new Error("observation is stale or invalid");

  return Object.freeze({
    ssid,
    bssid,
    channel: Math.trunc(channel),
    rssi,
    observedAt: new Date().toISOString(),
    source: "authorized-client-telemetry"
  });
}

export function createRogueApDetector({ trusted = [] } = {}) {
  const trustedBssids = new Set(trusted.map(normalizeMac).filter(Boolean));
  const listeners = new Set();

  function emit(event) {
    for (const listener of listeners) {
      try { listener(event); } catch {}
    }
  }

  function observe(input) {
    const observation = normalizeObservation(input);
    const trustedBssid = trustedBssids.has(observation.bssid);
    const event = Object.freeze({
      ...observation,
      trustedBssid,
      decision: trustedBssid ? "trusted" : "untrusted-observation",
      warning: trustedBssid ? null : "BSSID is not in the local trusted set; this is not proof of a rogue access point."
    });
    emit(event);
    return event;
  }

  return Object.freeze({
    observe,
    trustBssid(value) {
      const bssid = normalizeMac(value);
      if (!bssid) throw new Error("invalid BSSID");
      trustedBssids.add(bssid);
      return { bssid, trusted: true };
    },
    revokeBssid(value) {
      const bssid = normalizeMac(value);
      if (!bssid) throw new Error("invalid BSSID");
      trustedBssids.delete(bssid);
      return { bssid, trusted: false };
    },
    isTrusted(value) {
      return trustedBssids.has(normalizeMac(value));
    },
    trustedBssids() {
      return [...trustedBssids];
    },
    onObservation(listener) {
      if (typeof listener !== "function") throw new Error("listener must be a function");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return {
        enabled: true,
        mode: "authorized-telemetry",
        trustedBssidCount: trustedBssids.size,
        capabilities: ["observe-bssid", "observe-ssid", "observe-rssi", "observe-channel", "trust-revoke"],
        limitations: [
          "No monitor-mode capture",
          "No packet sniffing",
          "No command injection",
          "Untrusted BSSID is not cryptographic proof of a rogue AP"
        ]
      };
    }
  });
}

export { normalizeObservation };
