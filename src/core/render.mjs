import { uid, now } from "./id.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { buildFfmpegPlan } from "./ffmpeg.mjs";

export class RenderQueue{
 constructor(){this.jobs=new Map();}
 enqueue(input={}){
  const j={id:uid("render"),status:"queued",sceneId:input.sceneId??null,shotIds:[...(input.shotIds??[])],format:input.format??"master",settings:input.settings??{},createdAt:now()};
  this.jobs.set(j.id,j);return j;
 }
 get(id){return this.jobs.get(id)??null;}
 list(){return [...this.jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 mark(id,status,patch={}){const j=this.get(id);if(!j)throw new Error("Render job not found");Object.assign(j,patch,{status,updatedAt:now()});return j;}
 snapshot(){return this.list();}
 restore(items=[]){this.jobs.clear();for(const j of items)this.jobs.set(j.id,{...j,shotIds:[...(j.shotIds??[])]});return this;}
 async writeManifest(job,scenes=[],outDir="./data/runtime/renders"){
  await fs.mkdir(outDir,{recursive:true});
  const scene=scenes.find(s=>s.id===job.sceneId)??null;
  const shots=scene?scene.shots.filter(s=>job.shotIds.length===0||job.shotIds.includes(s.id)):[];
  const media=shots.map(s=>s.mediaId).filter(Boolean);
  const manifest={version:2,jobId:job.id,format:job.format,settings:job.settings,scene,shots,media,audio:[],output:job.settings.output??job.id+".mp4",generatedAt:now(),ffmpeg:null};
  manifest.ffmpeg=buildFfmpegPlan({media:[],audio:[],format:job.format,output:manifest.output});
  const file=path.join(outDir,job.id+".json");await fs.writeFile(file,JSON.stringify(manifest,null,2));
  this.mark(job.id,"prepared",{manifestPath:file});
  return manifest;
 }
}
