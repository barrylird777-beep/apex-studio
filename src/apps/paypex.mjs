import { getPaypexSnapshot, buildPaypexBrief, scoreOpportunity } from "../core/paypex-core.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("paypex");

export async function payPexSnapshot() {
  const snapshot = await getPaypexSnapshot();
  return { app: { ...APP }, ...snapshot, engine: "PayPex", decisionCore: "PayPex", productionExecutionOwnedBy: "ApexStudio" };
}

export function createPayPexBrief(input = {}) {
  return { app: { ...APP }, ...buildPaypexBrief(input), engine: "PayPex", executionOwner: "ApexStudio" };
}

export function evaluatePayPex(input = {}) {
  return { appId: APP.id, engine: "PayPex", ...scoreOpportunity(input) };
}

export function payPexStatus(snapshot = null) {
  return { app: { ...APP }, product: "money-making stock and opportunity engine", state: snapshot?.state || "awaiting-evidence", evidenceBacked: snapshot?.state === "evidence-backed", productionSeparated: true, checkedAt: new Date().toISOString() };
}

export const paypexSnapshot = payPexSnapshot;
export const createPaypexBrief = createPayPexBrief;
export const evaluatePaypex = evaluatePayPex;
export const paypexStatus = payPexStatus;
