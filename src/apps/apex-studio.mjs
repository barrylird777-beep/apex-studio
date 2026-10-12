import { APEX_SYSTEMS, APEX_SURFACES, APEX_UNIVERSAL_CAPABILITIES, buildApexExecutionEnvelope } from "../core/apex-universe.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("apex-studio");

export function studioExecutionEnvelope(input = {}) {
  return buildApexExecutionEnvelope({
    ...input,
    system: APEX_SYSTEMS.APEX_STUDIO.id
  });
}

export function studioStatus() {
  return {
    app: { ...APP },
    system: { ...APEX_SYSTEMS.APEX_STUDIO },
    surfaces: Object.values(APEX_SURFACES)
      .filter(surface => surface.owner === APEX_SYSTEMS.APEX_STUDIO.id)
      .map(surface => ({ ...surface })),
    capabilities: [...APEX_UNIVERSAL_CAPABILITIES],
    owns: [
      "production",
      "mastering",
      "quality-control",
      "delivery",
      "infrastructure",
      "special-search",
      "teevee",
      "engine-apex",
      "shield-apex"
    ],
    checkedAt: new Date().toISOString()
  };
}
