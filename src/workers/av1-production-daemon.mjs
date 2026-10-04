import { spawn } from "node:child_process";
import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import crypto from "node:crypto";
import { enqueueWorkerTask, claimNextWorkerTasks, completeWorkerTask, failWorkerTask, heartbeatWorkerTask } from "../core/mesh/durable-worker-store.mjs";

const CONCURRENCY=Math.max(1,Number(process.env.APEX_AV1_CONCURRENCY||process.env.APEX_JOB_CONCURRENCY||2));
const POLL_MS=Math.max(250,Number(process.env.APEX_PRODUCTION_POLL_MS||1000));
const FFMPEG=process.env.FFMPEG_PATH||"ffmpeg";
const OUTPUT_BUCKET=process.env.APEX_OBJECT_STORE_BUCKET||process.env.S3_BUCKET||"";
const OUTPUT_PREFIX=(process.env.APEX_AV1_OUTPUT_PREFIX||"av1").replace(/^\/+|\/+$/g,"");
const REGION=process.env.AWS_REGION||process.env.S3_REGION||"auto";
const ENDPOINT=process.env.APEX_OBJECT_STORE_ENDPOINT||process.env.S3_ENDPOINT||"";
const FORCE_PATH_STYLE=/^(1|true|yes)$/i.test(process.env.APEX_S3_FORCE_PATH_STYLE||"true");
let stopping=false;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

export async function enqueueProductionJob(payload={},options={}){
  const id=options.id||crypto.randomUUID();
  return (await enqueueWorkerTask({id,workerId:"av1-production",role:"av1",task:"AV1_ENCODE",payload,maxAttempts:Number(options.maxAttempts||process.env.APEX_AV1_MAX_ATTEMPTS||3)})).id;
}
function objectClient(){if(!OUTPUT_BUCKET)throw new Error("APEX_OBJECT_STORE_BUCKET or S3_BUCKET is required");return new S3Client({region:REGION,endpoint:ENDPOINT||undefined,forcePathStyle:FORCE_PATH_STYLE})}
function splitS3Url(value){const u=new URL(value);return u.protocol==="s3:"?{bucket:u.hostname,key:decodeURIComponent(u.pathname.replace(/^\//,""))}:null}
async function openInput(input){const s3=splitS3Url(input);if(s3){const r=await objectClient().send(new GetObjectCommand({Bucket:s3.bucket,Key:s3.key}));return Readable.fromWeb(r.Body.transformToWebStream())}const r=await fetch(input);if(!r.ok)throw Error("Input fetch failed: HTTP "+r.status);if(!r.body)throw Error("Input has no body");return Readable.fromWeb(r.body)}
function ffmpegArgs(job){const p=job.payload||{},input=p.input_url||p.inputUrl;if(!input)throw Error("Job requires input_url");const fps=Math.max(1,Math.min(120,Number(p.fps||24))),crf=Math.max(0,Math.min(63,Number(p.crf??30))),cpu=Math.max(0,Math.min(13,Number(p.cpuUsed??4))),w=p.width?Math.max(16,Number(p.width)):null,h=p.height?Math.max(16,Number(p.height)):null,scale=w&&h?["-vf",`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`]:[],format=String(p.format||"mp4").toLowerCase()==="webm"?"webm":"mp4";const codec=["-c:v","libsvtav1","-crf",String(crf),"-preset",String(cpu),"-r",String(fps),...scale];return{input,format,args:["-hide_banner","-loglevel","error","-i","pipe:0","-map","0:v:0","-an",...codec,...(format==="mp4"?["-pix_fmt","yuv420p","-movflags","frag_keyframe+empty_moov+default_base_moof"]:[]),"-f",format,"pipe:1"]}}
function bodyStream(body){if(!body)throw Error("No object-store body");if(typeof body.pipe==="function")return body;if(typeof body.transformToWebStream==="function")return Readable.fromWeb(body.transformToWebStream());throw Error("Unsupported object-store body")}
async function streamToObjectStore(readable,key,contentType){const body=new PassThrough();const upload=new Upload({client:objectClient(),params:{Bucket:OUTPUT_BUCKET,Key:key,Body:body,ContentType:contentType},queueSize:1,partSize:8*1024*1024,leavePartsOnError:false});const done=upload.done();readable.on("error",e=>body.destroy(e));readable.pipe(body);return done}
async function encode(job){const spec=ffmpegArgs(job),input=await openInput(spec.input),ff=spawn(FFMPEG,spec.args,{stdio:["pipe","pipe","pipe"]});let stderr="",bytes=0;ff.stderr.on("data",x=>{stderr+=x.toString();if(stderr.length>12000)stderr=stderr.slice(-12000)});ff.stdout.on("data",x=>{bytes+=x.length});input.on("error",e=>ff.stdin.destroy(e));input.pipe(ff.stdin);const key=`${OUTPUT_PREFIX}/${job.id}.${spec.format}`,uploadPromise=streamToObjectStore(ff.stdout,key,spec.format==="webm"?"video/webm":"video/mp4");ff.stdin.on("error",()=>{});ff.stdin.end();const [exit]=await once(ff,"close");const upload=await uploadPromise;if(exit!==0)throw Error(`ffmpeg exited ${exit}: ${stderr.trim()}`);return{key,bucket:OUTPUT_BUCKET,bytes,etag:upload?.ETag||null}}
async function runTask(task){const hb=setInterval(()=>void heartbeatWorkerTask(task.id,120000,task.lease_token).catch(()=>{}),30000);try{await completeWorkerTask(task.id,await encode(task),task.lease_token)}catch(e){await failWorkerTask(task.id,e,task.lease_token)}finally{clearInterval(hb)}}
async function loop(){while(!stopping){try{const tasks=await claimNextWorkerTasks(CONCURRENCY,120000,"AV1_ENCODE");if(!tasks.length){await sleep(POLL_MS);continue}await Promise.all(tasks.map(runTask))}catch(e){console.error("[av1-worker]",e?.message||e);await sleep(POLL_MS)}}}
export async function startProductionDaemon(){if(!process.env.DATABASE_URL)throw Error("DATABASE_URL is required for AV1 production");await loop()}
for(const s of ["SIGINT","SIGTERM"])process.once(s,()=>{stopping=true});
if(process.argv[1]&&new URL(import.meta.url).pathname===new URL(process.argv[1],"file:").pathname)await startProductionDaemon();
