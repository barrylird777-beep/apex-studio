import { APEX_APPS, assertSixAppInvariant } from "./apex-six-apps.mjs";

const HANDOFFS = Object.freeze([
  Object.freeze({ from:"planet-apex", to:"ko-blocks", purpose:"turn world context into reusable execution blocks" }),
  Object.freeze({ from:"ko-blocks", to:"kernel-vision", purpose:"route validated production graphs toward finished-work presentation" }),
  Object.freeze({ from:"kernelodies", to:"kernel-vision", purpose:"attach music and audio identity to finished work" }),
  Object.freeze({ from:"koin-kob", to:"kash-korner", purpose:"translate worker-market value into ledger entries" }),
  Object.freeze({ from:"kash-korner", to:"koin-kob", purpose:"provide validated financial state for economic simulations" }),
  Object.freeze({ from:"kernel-vision", to:"planet-apex", purpose:"feed finished-work context back into the world model" })
]);

export function canonicalTrajectory() {
  assertSixAppInvariant();
  const apps = Object.values(APEX_APPS).map(app => ({
    id: app.id,
    name: app.name,
    role: app.role,
    entry: app.entry
  }));
  return {
    contractVersion: "apex-canonical-trajectory.v1",
    apps,
    handoffs: HANDOFFS.map(handoff => ({ ...handoff })),
    closedLoop: true,
    persistence: "caller-owned; no process-local durability claim",
    checkedAt: new Date().toISOString()
  };
}

export function validateCanonicalTrajectory(trajectory = canonicalTrajectory()) {
  if (!trajectory || trajectory.contractVersion !== "apex-canonical-trajectory.v1") {
    throw new Error("Invalid canonical trajectory contract");
  }
  const ids = new Set(trajectory.apps.map(app => app.id));
  if (ids.size !== 6 || ids.size !== Object.keys(APEX_APPS).length) {
    throw new Error("Canonical trajectory must contain exactly six apps");
  }
  for (const handoff of trajectory.handoffs) {
    if (!ids.has(handoff.from) || !ids.has(handoff.to) || handoff.from === handoff.to) {
      throw new Error("Canonical trajectory contains an invalid handoff");
    }
    if (!String(handoff.purpose || "").trim()) {
      throw new Error("Canonical trajectory handoff requires a purpose");
    }
  }
  return true;
}

export function canonicalNeighbors(appId) {
  const id = String(appId ?? "");
  const known = Object.values(APEX_APPS).some(app => app.id === id);
  if (!known) throw new Error("Unknown Apex app: " + id);
  return HANDOFFS.filter(h => h.from === id || h.to === id).map(h => ({ ...h }));
}
}
