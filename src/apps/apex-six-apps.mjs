/**
 * Canonical six-app registry.
 *
 * The names below are locked Apex canon. Roles use the recovered high-level
 * definitions only. Missing historical implementation details are not invented.
 */
export const APEX_APPS = Object.freeze({
  PLANET_APEX: Object.freeze({
    id: "planet-apex",
    name: "PlanetApeX",
    role: "planetary/world-level Apex environment",
    entry: "/planet-apex.html"
  }),
  KO_BLOCKS: Object.freeze({
    id: "ko-blocks",
    name: "KoBlocks",
    role: "modular building environment for reusable Apex blocks",
    entry: "/ko-blocks.html"
  }),
  KERNEL_VISION: Object.freeze({
    id: "kernel-vision",
    name: "KernelVision",
    role: "visual/cinematic viewing; KernelVision Theatre and Kornmax",
    entry: "/kernel-vision.html"
  }),
  KOIN_KOB: Object.freeze({
    id: "koin-kob",
    name: "KoinKob",
    role: "money, value and economic side of Apex",
    entry: "/koin-kob.html"
  }),
  KASH_KORNER: Object.freeze({
    id: "kash-korner",
    name: "KashKorner",
    role: "practical cash and financial side of Apex",
    entry: "/kash-korner.html"
  }),
  KERNELDIES: Object.freeze({
    id: "kernelodies",
    name: "Kernelodies",
    role: "music, sound, audio creation and audio identity",
    entry: "/kernelodies.html"
  })
});

export const APEX_APP_IDS = Object.freeze(Object.values(APEX_APPS).map(app => app.id));

export function getApexApp(id) {
  return Object.values(APEX_APPS).find(app => app.id === String(id)) ?? null;
}

export function assertApexApp(id) {
  const app = getApexApp(id);
  if (!app) throw new Error("Unknown Apex app: " + id);
  return app;
}

export function listApexApps() {
  return Object.values(APEX_APPS).map(app => ({ ...app }));
}

export function assertSixAppInvariant() {
  if (APEX_APP_IDS.length !== 6) throw new Error("Apex must expose exactly six canonical apps");
  const names = new Set(Object.values(APEX_APPS).map(app => app.name));
  if (names.size !== 6) throw new Error("Apex canonical app names must be unique");
  return true;
}
