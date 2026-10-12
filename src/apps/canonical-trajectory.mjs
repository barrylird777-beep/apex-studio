import { APEX_APPS, assertSixAppInvariant } from "./apex-six-apps.mjs";

const APP_LIST = Object.values(APEX_APPS);
const APP_IDS = new Set(APP_LIST.map(app => app.id));
const SPECIFIC_PURPOSES = new Map([
  ["planet-apex->xshield", "apply network protection to the shared Apex environment"],
  ["xshield->kernel-vision", "provide protected network access for production and finished-work delivery"],
  ["kernelodies->kernel-vision", "attach music and audio identity to finished work"],
  ["kernel-vision->kash-korner", "hand off customer orders and production fulfillment for payment and ledger tracking"],
  ["kash-korner->kernel-vision", "return verified payment state and fulfillment authorization to production"],
  ["koin-kob->kash-korner", "translate worker-market value into ledger entries"],
  ["kash-korner->koin-kob", "provide validated financial state for economic simulations"],
  ["kernel-vision->planet-apex", "feed finished-work context back into the world model"]
]);

// Every canonical app has a directed, namespaced handoff to each of the other five.
const HANDOFFS = Object.freeze(APP_LIST.flatMap(from => APP_LIST
  .filter(to => to.id !== from.id)
  .map(to => Object.freeze({
    from: from.id,
    to: to.id,
    purpose: SPECIFIC_PURPOSES.get(`${from.id}->${to.id}`)
      || `exchange validated, namespaced ${from.name} state with ${to.name} under the shared Apex contract`
  }))));

export function canonicalTrajectory() {
  assertSixAppInvariant();
  const apps = APP_LIST.map(app => ({
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
    persistence: "Pure-WAL durable queue; remote delivery remains pending until an allowlisted peer acknowledges",
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
  if (trajectory.handoffs.length !== 30) {
    throw new Error("Canonical trajectory must connect all six apps in both directions");
  }
  const pairs = new Set();
  const outgoing = new Map([...ids].map(id => [id, new Set()]));
  for (const handoff of trajectory.handoffs) {
    if (!ids.has(handoff.from) || !ids.has(handoff.to) || handoff.from === handoff.to) {
      throw new Error("Canonical trajectory contains an invalid handoff");
    }
    if (!String(handoff.purpose || "").trim()) {
      throw new Error("Canonical trajectory handoff requires a purpose");
    }
    const key = `${handoff.from}->${handoff.to}`;
    if (pairs.has(key)) throw new Error("Canonical trajectory contains a duplicate handoff");
    pairs.add(key);
    outgoing.get(handoff.from).add(handoff.to);
  }
  if ([...outgoing.values()].some(targets => targets.size !== 5)) {
    throw new Error("Every canonical app must hand off to all five other apps");
  }
  return true;
}

export function canonicalNeighbors(appId) {
  const id = String(appId ?? "");
  if (!APP_IDS.has(id)) throw new Error("Unknown Apex app: " + id);
  return HANDOFFS.filter(h => h.from === id || h.to === id).map(h => ({ ...h }));
}
