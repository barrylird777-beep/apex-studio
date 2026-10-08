import { executeRapidVideoOrder, executeRapidVideoPreview } from "../workers/rapid-video-worker.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("apex-rapid-production");

export async function createPreview(payload = {}) {
  return {
    app: { ...APP },
    ...(await executeRapidVideoPreview(payload)),
    appId: APP.id
  };
}

export async function createProduction(payload = {}) {
  return {
    app: { ...APP },
    ...(await executeRapidVideoOrder(payload)),
    appId: APP.id
  };
}

export function rapidProductionStatus() {
  return {
    app: { ...APP },
    priceUsd: 25,
    previewSeconds: 10,
    paidOutputSeconds: 30,
    aspectRatio: "9:16",
    output: "MP4 H.264/AAC",
    execution: "durable-worker-capable",
    checkedAt: new Date().toISOString()
  };
}
