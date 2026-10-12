export const APEX_APPS = Object.freeze({
  PLANET_APEX: Object.freeze({ id:"planet-apex", name:"PlanetApeX", role:"knowledge, research, and world context for the APEX universe", entry:"/planet-apex.html", module:"../apps/planet-apex.mjs" }),
  KERNEL_VISION: Object.freeze({ id:"kernel-vision", name:"KernelVision", role:"cinematic production, editing, rendering, publishing, analytics, and original programming", entry:"/kernel-vision.html", module:"../apps/kernel-vision.mjs" }),
  KERNELDIES: Object.freeze({ id:"kernelodies", name:"Kernelodies", role:"music, sound, audio creation, and audio provenance", entry:"/kernelodies.html", module:"../apps/kernelodies.mjs" }),
  KASH_KORNER: Object.freeze({ id:"kash-korner", name:"KashKorner", role:"revenue connectivity, payment events, and financial handoffs", entry:"/kash-korner.html", module:"../apps/kash-korner.mjs" }),
  KASH_KOBS: Object.freeze({ id:"kash-kobs", name:"KashKobs", role:"monetization opportunities and revenue intelligence", entry:"/kash-kobs.html", module:"../apps/kash-kobs.mjs" }),
  XSHIELD: Object.freeze({ id:"xshield", name:"XShield", role:"security, privacy, and ad/tracker blocking", entry:"/xshield.html", module:"../apps/xshield.mjs" })
});
export const APEX_APP_IDS = Object.freeze(Object.values(APEX_APPS).map(app=>app.id));

// Historical and supporting capabilities remain addressable for compatibility,
// but they are not counted as canonical apps or used to replace the locked six.
const LEGACY_SUPPORT_APPS = Object.freeze({
  "ko-blocks": Object.freeze({ id:"ko-blocks", name:"KoBlocks", system:"apex-studio", role:"legacy reusable-block capability", entry:"/ko-blocks.html", canonical:false }),
  "koin-kob": Object.freeze({ id:"koin-kob", name:"KoinKob", system:"apex-studio", role:"legacy worker-market capability", entry:"/koin-kob.html", canonical:false }),
  "korn-knob": Object.freeze({ id:"korn-knob", name:"KornKnob", system:"kornknob", role:"legacy capability surface", entry:"/korn-knob.html", canonical:false }),
  "teevee": Object.freeze({ id:"teevee", name:"TeeVee", system:"apex-studio", role:"legacy production/network surface", entry:"/teevee-buyer.html", canonical:false }),
  "paypex": Object.freeze({ id:"paypex", name:"PayPex", system:"apex-studio", role:"legacy opportunity intelligence surface", entry:"/paypex.html", canonical:false }),
  "apex-studio": Object.freeze({ id:"apex-studio", name:"ApexStudio", system:"apex-studio", role:"historical production surface", entry:"/", canonical:false }),
  "garden-of-apex": Object.freeze({ id:"garden-of-apex", name:"GardenOfApex", system:"garden-of-apex", role:"supporting knowledge system surface", entry:"/garden-of-apex.html", canonical:false })
});

export function getApexApp(id){
  const value=String(id);
  return Object.values(APEX_APPS).find(app=>app.id===value) ?? LEGACY_SUPPORT_APPS[value] ?? null;
}
export function assertApexApp(id){
  const value=String(id);
  const app=Object.values(APEX_APPS).find(item=>item.id===value);
  if(!app) throw new Error("Unknown canonical Apex app: "+id);
  return app;
}
export function listApexApps(){ return Object.values(APEX_APPS).map(app=>({...app})); }
export function assertSixAppInvariant(){
  const apps=Object.values(APEX_APPS);
  if(apps.length!==6) throw new Error("Apex must expose exactly six canonical apps");
  if(new Set(apps.map(app=>app.name)).size!==6) throw new Error("Apex canonical app names must be unique");
  if(APEX_APP_IDS.join("|")!=="planet-apex|kernel-vision|kernelodies|kash-korner|kash-kobs|xshield") {
    throw new Error("Apex canonical app identities do not match the locked six-app contract");
  }
  return true;
}
