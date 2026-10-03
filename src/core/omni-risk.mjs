import crypto from "node:crypto";
import { now } from "./id.mjs";

export const OMNI_TRIGGER = "[WILLY-NILLY]";
export const APEX_PROTOCOL_OFFSWITCH = String(process.env.APEX_PROTOCOL_OFFSWITCH ?? "NILLY-WILLY").trim();

export function isProtocolOffSwitch(value) {
  const candidate = String(value ?? "").trim();
  return Boolean(APEX_PROTOCOL_OFFSWITCH) && candidate === APEX_PROTOCOL_OFFSWITCH;
}

export function detectOmniTrigger(value) {
  return !isProtocolOffSwitch(value) && String(value ?? "").includes(OMNI_TRIGGER);
}

export function buildRiskReport({ query = "", sources = [], writes = [] } = {}) {
  return {
    at: now(),
    mode: "STANDARD",
    network: {
      outboundRequests: sources.length,
      policy: "explicit allowlist",
      telemetry: "disabled",
      credentials: "never persisted or forwarded"
    },
    storage: {
      plannedWrites: writes.length,
      paths: writes.map(x => String(x.path ?? "")).slice(0, 50),
      mutation: "frozen until explicit confirmation"
    },
    process: {
      concurrency: "bounded",
      dynamicCodeExecution: false
    },
    safeguards: [
      "security policy remains active",
      "external content is untrusted data",
      "no secret forwarding"
    ]
  };
}

export function createRiskHandshake(report) {
  return {
    id: crypto.randomUUID(),
    state: "awaiting_confirmation",
    report,
    createdAt: now()
  };
}
