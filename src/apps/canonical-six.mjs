import { assertApexApp, listApexApps } from "./apex-six-apps.mjs";
import { planetApexStatus } from "./planet-apex.mjs";
import { kernelVisionStatus } from "./kernel-vision.mjs";
import { kernelodiesStatus } from "./kernelodies.mjs";
import { kashKornerStatus } from "./kash-korner.mjs";
import { kashKobsStatus } from "./kash-kobs.mjs";
import { xshieldStatus } from "./xshield.mjs";

const statusFns=Object.freeze({
  "planet-apex":planetApexStatus,
  "kernel-vision":kernelVisionStatus,
  "kernelodies":kernelodiesStatus,
  "kash-korner":kashKornerStatus,
  "kash-kobs":kashKobsStatus,
  "xshield":xshieldStatus
});

export async function canonicalAppStatus(id){
  const app=assertApexApp(id);
  const result=await statusFns[app.id]();
  return {success:true,...result};
}
export async function canonicalAppsStatus(){
  const apps=listApexApps();
  const results=await Promise.allSettled(apps.map(app=>canonicalAppStatus(app.id)));
  return results.map((result,index)=>{
    const app=apps[index];
    if(result.status==="fulfilled")return result.value;
    return {
      success:false,
      app:{...app},
      role:app.role,
      canonical:true,
      status:"degraded",
      capabilities:[],
      error:String(result.reason?.message||result.reason||"App status unavailable"),
      checkedAt:new Date().toISOString()
    };
  });
}
