import crypto from "node:crypto";
import { canonicalNeighbors } from "./canonical-trajectory.mjs";

const MAX_PAYLOAD_BYTES = Math.max(1024, Number(process.env.APEX_HANDOFF_MAX_BYTES || 262144));
const MAX_EVENTS = Math.max(16, Number(process.env.APEX_HANDOFF_MAX_EVENTS || 1000));
const events = [];

const clone = value => structuredClone(value);

function assertPayload(payload) {
  const value = payload == null ? {} : payload;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Handoff payload must be an object");
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > MAX_PAYLOAD_BYTES) throw new RangeError("Handoff payload exceeds configured size limit");
  return clone(value);
}

function assertRoute(from, to) {
  const neighbors = canonicalNeighbors(from);
  if (!neighbors.some(handoff => handoff.from === from && handoff.to === to)) {
    throw new Error(`Invalid canonical handoff: ${from} -> ${to}`);
  }
}

export function publishCanonicalHandoff({ from, to, payload = {}, correlationId = null } = {}) {
  const source = String(from ?? "").trim();
  const target = String(to ?? "").trim();
  if (!source || !target) throw new TypeError("Handoff source and target are required");
  assertRoute(source, target);
  const event = {
    id: crypto.randomUUID(),
    contractVersion: "apex-canonical-handoff.v1",
    from: source,
    to: target,
    correlationId: correlationId ? String(correlationId).slice(0, 256) : crypto.randomUUID(),
    payload: assertPayload(payload),
    durable: false,
    createdAt: new Date().toISOString()
  };
  events.push(event);
  while (events.length > MAX_EVENTS) events.shift();
  return clone(event);
}

export function listCanonicalHandoffs({ appId = null, limit = 50 } = {}) {
  const id = appId == null ? null : String(appId).trim();
  if (id) canonicalNeighbors(id);
  const count = Math.max(1, Math.min(MAX_EVENTS, Number.isFinite(Number(limit)) ? Math.floor(Number(limit)) : 50));
  return clone(events.filter(event => !id || event.from === id || event.to === id).slice(-count));
}

export function clearCanonicalHandoffs() {
  events.length = 0;
  return { cleared: true };
}

export function canonicalHandoffStatus() {
  return {
    contractVersion: "apex-canonical-handoff.v1",
    durable: false,
    queued: events.length,
    maxEvents: MAX_EVENTS,
    maxPayloadBytes: MAX_PAYLOAD_BYTES,
    checkedAt: new Date().toISOString()
  };
}
