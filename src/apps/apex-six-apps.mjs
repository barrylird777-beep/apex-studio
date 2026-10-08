import { APEX_SYSTEMS } from "../core/apex-universe.mjs";

export const APEX_APPS = Object.freeze({
  KORN_KNOB: Object.freeze({ id: "korn-knob", name: "KornKnob", system: APEX_SYSTEMS.KORNKNOB.id, role: "audio and music capability", entry: "/korn-knob.html", module: "../core/korn-knob.mjs" }),
  TEEVEE: Object.freeze({ id: "teevee", name: "TeeVee", system: APEX_SYSTEMS.APEX_STUDIO.id, role: "24/7 television network and continuous programming", entry: "/teevee.html", module: "../core/teevee-broadcast.mjs" }),
  PAYPEX: Object.freeze({ id: "paypex", name: "PayPex", system: APEX_SYSTEMS.APEX_STUDIO.id, role: "money-making stock, market, business and monetization intelligence", entry: "/paypex.html", module: "../core/paypex-core.mjs" }),
  STUDIO: Object.freeze({ id: "apex-studio", name: "ApexStudio", system: APEX_SYSTEMS.APEX_STUDIO.id, role: "creative production, editing, mastering, QC and delivery", entry: "/", module: "../core/apex-universe.mjs" }),
  GARDEN: Object.freeze({ id: "garden-of-apex", name: "GardenOfApex", system: APEX_SYSTEMS.GARDEN_OF_APEX.id, role: "knowledge, Scripture, research and creative world", entry: "/garden-of-apex.html", module: "../core/garden-of-apex.mjs" }),
  XSHIELD: Object.freeze({ id: "xshield", name: "XShield", system: APEX_SYSTEMS.APEX_STUDIO.id, role: "ad blocking, tracker blocking and network filtering", entry: "/xshield.html", module: "./xshield.mjs" })
});

export const APEX_APP_IDS = Object.freeze(Object.values(APEX_APPS).map(app => app.id));
export function getApexApp(id) { return Object.values(APEX_APPS).find(app => app.id === String(id)) ?? null; }
export function assertApexApp(id) { const app = getApexApp(id); if (!app) throw new Error("Unknown Apex app: " + id); return app; }
export function listApexApps() { return Object.values(APEX_APPS).map(app => ({ ...app })); }
export function assertSixAppInvariant() { if (APEX_APP_IDS.length !== 6) throw new Error("Apex must expose exactly six canonical apps"); const names = new Set(Object.values(APEX_APPS).map(app => app.name)); if (names.size !== 6) throw new Error("Apex canonical app names must be unique"); return true; }
