export const APEX_APPS = Object.freeze({
  PLANET_APEX: Object.freeze({ id:"planet-apex", name:"PlanetApeX", role:"world and planetary Apex environment", entry:"/planet-apex.html", module:"../apps/planet-apex.mjs" }),
  KO_BLOCKS: Object.freeze({ id:"ko-blocks", name:"KoBlocks", role:"modular building and reusable Apex blocks", entry:"/ko-blocks.html", module:"../apps/ko-blocks.mjs" }),
  KERNEL_VISION: Object.freeze({ id:"kernel-vision", name:"KernelVision", role:"finished-work viewing through KernelVision Theatre and Kornmax", entry:"/kernel-vision.html", module:"../apps/kernel-vision.mjs" }),
  KOIN_KOB: Object.freeze({ id:"koin-kob", name:"KoinKob", role:"economy, value, barter and autonomous worker markets", entry:"/koin-kob.html", module:"../apps/koin-kob.mjs" }),
  KASH_KORNER: Object.freeze({ id:"kash-korner", name:"KashKorner", role:"cash, ledger and financial state", entry:"/kash-korner.html", module:"../apps/kash-korner.mjs" }),
  KERNELDIES: Object.freeze({ id:"kernelodies", name:"Kernelodies", role:"music, sound, audio creation and audio identity", entry:"/kernelodies.html", module:"../apps/kernelodies.mjs" })
});
export const APEX_APP_IDS = Object.freeze(Object.values(APEX_APPS).map(app=>app.id));
export function getApexApp(id){ return Object.values(APEX_APPS).find(app=>app.id===String(id)) ?? null; }
export function assertApexApp(id){ const app=getApexApp(id); if(!app) throw new Error("Unknown Apex app: "+id); return app; }
export function listApexApps(){ return Object.values(APEX_APPS).map(app=>({...app})); }
export function assertSixAppInvariant(){
  if(APEX_APP_IDS.length!==6) throw new Error("Apex must expose exactly six canonical apps");
  if(new Set(Object.values(APEX_APPS).map(app=>app.name)).size!==6) throw new Error("Apex canonical app names must be unique");
  return true;
}
