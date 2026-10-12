import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("kernel-vision");
const clone = value => structuredClone(value);

const safeText = (value, fallback = "") => String(value ?? fallback).trim().slice(0, 4000);
const safeId = value => { const id = safeText(value); if (!id || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(id)) throw new TypeError("KernelVision id is invalid"); return id; };

export function createTheatreItem(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("KernelVision item input must be an object");
  const mediaUrl = safeText(input.mediaUrl);
  return {
    id: safeId(input.id || crypto.randomUUID()),
    title: safeText(input.title, "Untitled") || "Untitled",
    mediaUrl,
    kind: safeText(input.kind, "finished-work") || "finished-work",
    status: safeText(input.status, "ready") || "ready",
    provenance: input.provenance && typeof input.provenance === "object" && !Array.isArray(input.provenance) ? clone(input.provenance) : null,
    createdAt: new Date().toISOString()
  };
}

export function createViewingSession(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("KernelVision session input must be an object");
  const item = createTheatreItem(input.item || input);
  return {
    sessionId: safeId(input.sessionId || crypto.randomUUID()),
    itemId: item.id,
    item,
    display: "Kornmax",
    theatre: "KernelVision Theatre",
    mode: safeText(input.mode, "cinematic") || "cinematic",
    startedAt: new Date().toISOString()
  };
}

export function kernelVisionStatus() {
  return {
    app: { ...APP },
    role: APP.role,
    theatre: "KernelVision Theatre",
    display: "Kornmax",
    capabilities: ["finished-work viewing", "cinematic display", "viewing sessions", "provenance display"],
    canonical: true,
    checkedAt: new Date().toISOString()
  };
}
