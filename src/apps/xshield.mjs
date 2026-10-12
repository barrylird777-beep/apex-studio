import { handleStudioAdBlockDoH, initializeStudioAdBlock, studioAdBlockStatus } from "../network/studio-adblock-doh.mjs";
import { studioAdBlockMobileConfig } from "../network/studio-adblock-profile.mjs";
import { classifyNetworkRequest, contentFilterStatus, buildSafariContentBlockerRules } from "../network/apex-content-filter.mjs";
import { getApexApp } from "./apex-six-apps.mjs";
import { sovereignAppFabric } from "../core/sovereign-app-fabric.mjs";

const APP = getApexApp("xshield");

export async function initializeXShield() {
  await initializeStudioAdBlock();
  return xshieldStatus();
}

export function xshieldStatus() {
  return {
    app: { ...APP },
    product: "ad blocker",
    dns: studioAdBlockStatus(),
    contentFilter: contentFilterStatus(),
    safariRules: buildSafariContentBlockerRules().length,
    filtering: true,
    firstPartyPolicy: "always-allow",
    checkedAt: new Date().toISOString()
  };
}

export function classifyXShieldRequest(url, options = {}) {
  return classifyNetworkRequest(url, options);
}

export function xshieldMobileConfig() {
  return studioAdBlockMobileConfig();
}

export { handleStudioAdBlockDoH };

// XShield records share the sovereign durable namespace without moving
// filtering/security policy into KernelVision or another application.
export const saveXShieldRecord=(id,record,fabric=sovereignAppFabric)=>fabric.put(APP.id,id,record);
export const getXShieldRecord=(id,fabric=sovereignAppFabric)=>fabric.get(APP.id,id);
export const listXShieldRecords=(fabric=sovereignAppFabric)=>fabric.list(APP.id);
