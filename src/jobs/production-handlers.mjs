import { generateUnifiedAi } from "../providers/unified-ai-router.mjs";
import { enqueueWorkerTask } from "../core/mesh/durable-worker-store.mjs";
import { randomUUID } from "node:crypto";
import { executeRapidTrendRender } from "../workers/rapid-video-worker.mjs";
const clean=v=>String(v??"").trim().slice(0,2000);
async function analyzeTrend(job){
  const trend=clean(job.payload?.trend), source=clean(job.payload?.source);
  const prompt=JSON.stringify({trend,source,goal:"Create an original Apex Rapid Video concept inspired by the trend without copying protected expression.",style:"dark cinematic anime, sharp cel shading, high contrast lighting",output:"hook,title,concept,visualDirection"});
  let plan;
  try {
    const r=await generateUnifiedAi({provider:process.env.APEX_TREND_AI_PROVIDER||"openrouter",model:process.env.APEX_TREND_AI_MODEL,system:"Return JSON only. Never reproduce a source work verbatim. Transform the trend into an original creative concept.",prompt,temperature:0.8,max_tokens:900});
    plan=JSON.parse(String(r.text||"").trim());
  } catch(error) { plan={hook:"TREND SIGNAL DETECTED.",title:trend,concept:trend,visualDirection:"Original dark cinematic anime"}; }
  await enqueueWorkerTask({id:randomUUID(),workerId:"rapid-video",role:"creative",task:"rapid.trend.render",payload:{trend,source,plan},maxAttempts:5,dedupeKey:"rapid-trend-render:"+(job.payload?.fingerprint||trend.toLowerCase())});
  return {analyzed:true,plan};
}
export const handlers={"trend.analyze":analyzeTrend};
export default handlers;
