import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("kernel-vision");
const clone = value => structuredClone(value);

const safeText = (value, fallback = "") => String(value ?? fallback).trim().slice(0, 4000);

export function createTheatreItem(input = {}) {
  const mediaUrl = safeText(input.mediaUrl);
  return {
    id: safeText(input.id || crypto.randomUUID()),
    title: safeText(input.title, "Untitled") || "Untitled",
    mediaUrl,
    kind: safeText(input.kind, "finished-work") || "finished-work",
    status: safeText(input.status, "ready") || "ready",
    provenance: input.provenance && typeof input.provenance === "object" && !Array.isArray(input.provenance) ? clone(input.provenance) : null,
    createdAt: new Date().toISOString()
  };
}

export function createViewingSession(input = {}) {
  const item = createTheatreItem(input.item || input);
  return {
    sessionId: safeText(input.sessionId || crypto.randomUUID()),
    itemId: item.id,
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
