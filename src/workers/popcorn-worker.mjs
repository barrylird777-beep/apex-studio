import crypto from "node:crypto";
import { db } from "../db/index.js";
import { biblePassages } from "../db/schema.js";
import { eq, inArray } from "drizzle-orm";
import { GeminiMeshProvider } from "../core/mesh/gemini-mesh-provider.mjs";
import { MultiAiCoordinator } from "../core/mesh/multi-ai-coordinator.mjs";
import { claimNextWorkerTasks, completeWorkerTask, failWorkerTask, heartbeatWorkerTask, enqueueWorkerTask } from "../core/mesh/durable-worker-store.mjs";
import { upsertPopcorns, ensurePopcornSchema } from "../core/bible/popcorn-store.mjs";

const BATCH_SIZE=Math.max(10,Math.min(100,Number(process.env.APEX_POPCORN_BATCH_SIZE||50)));
const CLAIM_SIZE=Math.max(1,Math.min(100,Number(process.env.APEX_POPCORN_CLAIM_SIZE||100)));
const CONCURRENCY=Math.max(1,Math.min(200,Number(process.env.APEX_POPCORN_CONCURRENCY||64)));

function parse(text){const s=String(text||"").trim(),a=s.indexOf("["),b=s.lastIndexOf("]");if(a<0||b<a)throw Error("PopcornStructuredOutputMissing");return JSON.parse(s.slice(a,b+1))}
function prompt(rows){return [
"You are Apex Bible Finder Crew. Analyze every supplied canonical verse independently.",
"Return ONLY one JSON object per input verse.",
"The excerpt MUST exactly equal the supplied verse text. Never rewrite Scripture.",
"Keys: reference,excerpt,title,cinematicReason,characterMoment,visualMoment,dialoguePotential,conflictTension,emotionalBeat,productionPotential,popcornRank,confidence,tags.",
"popcornRank 0-100; confidence 0-1. Low rank is valid.",
JSON.stringify(rows.map(x=>({id:x.id,reference:x.reference,text:x.text})))
].join("\n\n")}
async function processTask(task,coordinator){
  const ids=Array.isArray(task.payload?.passageIds)?task.payload.passageIds.slice(0,BATCH_SIZE):[];
  if(!ids.length)return{popcorns:0};
  const rows=await db.select().from(biblePassages).where(inArray(biblePassages.id,ids));
  if(rows.length!==ids.length)throw Error("CanonicalPassageMissing");
  const result=await coordinator.run({task:prompt(rows),providers:["gemini"],system:"Canonical database text is authoritative. Return strict JSON only."});
  if(!result.ok)throw Error("PopcornInferenceFailed");
  const analyzed=parse(result.synthesis?.text||result.results.find(x=>x.ok)?.text);
  if(analyzed.length!==rows.length)throw Error("PopcornCountMismatch");
  const output=analyzed.map((x,i)=>{
    const excerpt=String(x.excerpt||"");
    if(excerpt!==rows[i].text)throw Error("PopcornExcerptMismatch:"+rows[i].reference);
    return {collectionId:rows[i].collectionId,reference:rows[i].reference,excerpt,book:rows[i].book,chapter:rows[i].chapter,verseStart:rows[i].verseStart,verseEnd:rows[i].verseEnd,title:x.title||null,cinematicReason:String(x.cinematicReason||""),characterMoment:x.characterMoment||null,visualMoment:x.visualMoment||null,dialoguePotential:x.dialoguePotential||null,conflictTension:x.conflictTension||null,emotionalBeat:x.emotionalBeat||null,productionPotential:x.productionPotential||null,popcornRank:Number(x.popcornRank)||0,confidence:Number(x.confidence)||0,verificationStatus:"ai-review",canonicalSource:rows[i].sourceId?String(rows[i].sourceId):null,provenance:{crew:"bible-finder",task:"POPCORN_DISCOVERY",model:result.synthesis?.model||result.results.find(y=>y.ok)?.model||null},tags:Array.isArray(x.tags)?x.tags:[]};
  });
  return {popcorns:(await upsertPopcorns(output)).length};
}
export async function enqueuePopcornPassages(passageIds,workerId="popcorn-dispatcher"){
  const ids=Array.isArray(passageIds)?passageIds.map(Number).filter(Number.isInteger):[],out=[];
  for(let i=0;i<ids.length;i+=BATCH_SIZE){
    const batch=ids.slice(i,i+BATCH_SIZE),hex=crypto.createHash("sha256").update(JSON.stringify(batch)).digest("hex").slice(0,32),id=hex.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/,"$1-$2-$3-$4-$5");
    await enqueueWorkerTask({id,workerId,role:"bible-finder-popcorn",task:"BIBLE_POPCORN_DISCOVERY",payload:{passageIds:batch},maxAttempts:5});out.push(id);
  }
  return out;
}
export function startPopcornWorker({coordinator=new MultiAiCoordinator({providers:{gemini:new GeminiMeshProvider()}})}={}){
  let stopped=false;const running=new Set();
  async function launch(task){const hb=setInterval(()=>void heartbeatWorkerTask(task.id,120000,task.lease_token).catch(()=>{}),30000);try{await completeWorkerTask(task.id,await processTask(task,coordinator),task.lease_token)}catch(e){await failWorkerTask(task.id,e,task.lease_token)}finally{clearInterval(hb);running.delete(task.id)}}
  async function pump(){if(stopped)return;try{await ensurePopcornSchema();const cap=Math.max(0,CONCURRENCY-running.size);if(cap){for(const task of await claimNextWorkerTasks(Math.min(CLAIM_SIZE,cap),120000,"BIBLE_POPCORN_DISCOVERY")){running.add(task.id);void launch(task)}}}catch(e){console.error("[popcorn-worker]",e?.message||e)}finally{if(!stopped)setTimeout(pump,running.size?25:500).unref?.()}}
  void pump();return{stop(){stopped=true},status(){return{running:running.size,concurrency:CONCURRENCY,batchSize:BATCH_SIZE}}};
}
