import { assertApexApp, listApexApps } from "./apex-six-apps.mjs";
import { planetApexStatus } from "./planet-apex.mjs";
import { koBlocksStatus } from "./ko-blocks.mjs";
import { kernelVisionStatus } from "./kernel-vision.mjs";
import { koinKobStatus } from "./koin-kob.mjs";
import { kashKornerStatus } from "./kash-korner.mjs";
import { kernelodiesStatus } from "./kernelodies.mjs";

const statusFns=Object.freeze({
  "planet-apex":planetApexStatus,
  "ko-blocks":koBlocksStatus,
  "kernel-vision":kernelVisionStatus,
  "koin-kob":koinKobStatus,
  "kash-korner":kashKornerStatus,
  "kernelodies":kernelodiesStatus
});

export async function canonicalAppStatus(id){
  const app=assertApexApp(id);
  const result=await statusFns[app.id]();
  return {success:true,...result};
}
export async function canonicalAppsStatus(){
  const results = await Promise.allSettled(listApexApps().map(app => canonicalAppStatus(app.id)));
  return results.map((result, index) => {
    const app = listApexApps()[index];
    if (result.status === "fulfilled") return result.value;
    return {
      success: false,
      app: { ...app },
      role: app.role,
      canonical: true,
      status: "degraded",
      capabilities: [],
      error: String(result.reason?.message || result.reason || "App status unavailable"),
      checkedAt: new Date().toISOString()
    };
  });
}
