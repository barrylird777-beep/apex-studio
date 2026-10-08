import { getPaypexSnapshot, buildPaypexBrief, scoreOpportunity } from "../core/paypex-core.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("paypex");

export async function paypexSnapshot() {
  const snapshot = await getEngineSnapshot();
  return {
    app: { ...APP },
    ...snapshot,
    engine: "Paypex",
    decisionCore: "Paypex",
    productionExecutionOwnedBy: "ApexStudio"
  };
}

export function createPaypexBrief(input = {}) {
  return {
    app: { ...APP },
    ...buildEngineBrief(input),
    engine: "Paypex",
    executionOwner: "ApexStudio"
  };
}

export function evaluatePaypex(input = {}) {
  return {
    appId: APP.id,
    engine: "Paypex",
    ...scoreOpportunity(input)
  };
}

export function paypexStatus(snapshot = null) {
  return {
    app: { ...APP },
    state: snapshot?.state || "awaiting-evidence",
    evidenceBacked: snapshot?.state === "evidence-backed",
    productionSeparated: true,
    checkedAt: new Date().toISOString()
  };
}
