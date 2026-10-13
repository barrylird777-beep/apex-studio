export const APEX_APPS = Object.freeze({
  PLANET_APEX: Object.freeze({ id:"planet-apex", name:"PlanetApeX", role:"brain of the Apex universe: knowledge, Bible study, research, AI, world context and interactive experiences", entry:"/", module:"../apps/planet-apex.mjs" }),
  XSHIELD: Object.freeze({ id:"xshield", name:"XShield", role:"security and privacy shield: ad and tracker blocking, DNS protection, content filtering and protected connectivity", entry:"/xshield.html", module:"../apps/xshield.mjs" }),
  KERNEL_VISION: Object.freeze({ id:"kernel-vision", name:"KernelVision", role:"eyes of the Apex universe: production, editing, rendering, publishing, analytics, KernelVision Theatre and Kornmax", entry:"/kernel-vision.html", module:"../apps/kernel-vision.mjs" }),
  KOIN_KOB: Object.freeze({ id:"koin-kob", name:"KoinKob", role:"autonomous economy: worker accounts, asset markets, market clearing, systemic events, adversarial rounds and 2,000-worker simulations", entry:"/koin-kob.html", module:"../apps/koin-kob.mjs" }),
  KASH_KORNER: Object.freeze({ id:"kash-korner", name:"KashKorner", role:"cash and ledger layer: financial state, cash flow, monetization and network/connectivity coordination", entry:"/kash-korner.html", module:"../apps/kash-korner.mjs" }),
  KERNELDIES: Object.freeze({ id:"kernelodies", name:"Kernelodies", role:"ears of the Apex universe: music, sound, audio creation and audio identity", entry:"/kernelodies.html", module:"../apps/kernelodies.mjs" })
});
export const APEX_APP_IDS = Object.freeze(Object.values(APEX_APPS).map(app=>app.id));

const LEGACY_SUPPORT_APPS = Object.freeze({
  "korn-knob": Object.freeze({ id:"korn-knob", name:"KornKnob", system:"kernelodies", role:"historical music identity absorbed into Kernelodies", entry:"/korn-knob.html" }),
  "teevee": Object.freeze({ id:"teevee", name:"TeeVee", system:"kernel-vision", role:"historical 24/7 entertainment programming and broadcast surface owned by KernelVision", entry:"/teevee-buyer.html" }),
  "paypex": Object.freeze({ id:"paypex", name:"PayPex", system:"kash-korner", role:"historical opportunity, market and monetization intelligence surface owned by KashKorner", entry:"/paypex.html" }),
  "apex-studio": Object.freeze({ id:"apex-studio", name:"ApexStudio", system:"apex-studio", role:"supporting production system surface", entry:"/" }),
  "garden-of-apex": Object.freeze({ id:"garden-of-apex", name:"GardenOfApex", system:"planet-apex", role:"embedded PlanetApeX knowledge universe: Bible study, Jesus Freaks and KORNS PEOPLE", entry:"/garden-of-apex.html" }),
  "ko-blocks": Object.freeze({ id:"ko-blocks", name:"KoBlocks", system:"apex-studio", role:"reusable execution blocks, graph composition and validation capability; not a separate canonical app", entry:"/ko-blocks.html" }),
  "xshield-legacy": Object.freeze({ id:"xshield-legacy", name:"XShield legacy alias", system:"xshield", role:"compatibility alias for the canonical XShield security app", entry:"/xshield.html" })
});

export function getApexApp(id){
  const value=String(id);
  return Object.values(APEX_APPS).find(app=>app.id===value) ?? LEGACY_SUPPORT_APPS[value] ?? null;
}
export function assertApexApp(id){ const app=getApexApp(id); if(!app) throw new Error("Unknown Apex app: "+id); return app; }
export function listApexApps(){ return Object.values(APEX_APPS).map(app=>({...app})); }
export function assertSixAppInvariant(){
  if(APEX_APP_IDS.length!==6) throw new Error("Apex must expose exactly six canonical apps");
  if(new Set(Object.values(APEX_APPS).map(app=>app.name)).size!==6) throw new Error("Apex canonical app names must be unique");
  return true;
}
