import { assertApexApp, listApexApps } from "./apex-six-apps.mjs";

const state = new Map(
  listApexApps().map(app => [app.id, {
    state: "ready",
    revision: 1,
    updatedAt: new Date().toISOString()
  }])
);

export function canonicalAppStatus(id) {
  const app = assertApexApp(id);
  const runtime = state.get(app.id);
  return {
    success: true,
    app: { ...app },
    runtime: { ...runtime },
    capabilities: capabilitiesFor(app.id),
    checkedAt: new Date().toISOString()
  };
}

export function canonicalAppsStatus() {
  return listApexApps().map(app => canonicalAppStatus(app.id));
}

export function touchCanonicalApp(id) {
  const app = assertApexApp(id);
  const current = state.get(app.id);
  const next = {
    ...current,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString()
  };
  state.set(app.id, next);
  return canonicalAppStatus(app.id);
}

function capabilitiesFor(id) {
  switch (id) {
    case "planet-apex":
      return ["world-registry", "world-state", "cross-app navigation"];
    case "ko-blocks":
      return ["block registry", "reusable components", "composition"];
    case "kernel-vision":
      return ["finished-work viewing", "KernelVision Theatre", "Kornmax cinematic display"];
    case "koin-kob":
      return ["value tracking", "economic opportunities", "decision context"];
    case "kash-korner":
      return ["cash tracking", "financial records", "cash-flow context"];
    case "kernelodies":
      return ["music", "sound", "audio creation", "audio identity"];
    default:
      return [];
  }
}
