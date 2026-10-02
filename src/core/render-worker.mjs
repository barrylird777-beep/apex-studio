import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { now } from "./id.mjs";

function parseProgress(line){
  const i=line.indexOf("=");
  if(i<0)return null;
  const k=line.slice(0,i).trim(),v=line.slice(i+1).trim();
  return {key:k,value:v};
}

export class RenderWorker{
  constructor({ffmpegPath=process.env.FFMPEG_PATH||"ffmpeg",outputDir=process.env.APEX_RENDER_DIR||"./data/runtime/renders"}={}){
    this.ffmpegPath=ffmpegPath;this.outputDir=outputDir;this.running=new Map();
  }
  async available(){
    return await new Promise(resolve=>{
      const p=spawn(this.ffmpegPath,["-version"],{stdio:["ignore","pipe","pipe"]});
      p.once("error",()=>resolve(false));p.once("close",code=>resolve(code===0));
    });
  }
  async render(job,plan){
    if(!plan?.ready)throw new Error(plan?.reason||"Render plan is not ready");
    await fs.mkdir(this.outputDir,{recursive:true});
    const filename=path.basename(job.settings?.output||job.id+".mp4");
    const output=path.resolve(this.outputDir,filename);
    const args=[...plan.args];
    const oi=args.lastIndexOf(plan.args[plan.args.length-1]);
    if(oi>=0)args[oi]=output;
    const startedAt=now();
    return await new Promise((resolve,reject)=>{
      const child=spawn(this.ffmpegPath,args,{cwd:process.cwd(),stdio:["ignore","pipe","pipe"]});
      this.running.set(job.id,child);
      let stdout="",stderr="",progress={};
      child.stdout.on("data",b=>stdout+=b.toString());
      child.stderr.on("data",b=>{
        const s=b.toString();stderr+=s;
        for(const line of s.split(/\r?\n/)){const p=parseProgress(line);if(p)progress[p.key]=p.value;}
      });
      child.once("error",error=>{this.running.delete(job.id);reject(error)});
      child.once("close",(code,signal)=>{
        this.running.delete(job.id);
        const result={jobId:job.id,ok:code===0,code,signal,output:code===0?output:null,startedAt,finishedAt:now(),progress,stdout:stdout.slice(-4000),stderr:stderr.slice(-8000)};
        code===0?resolve(result):reject(Object.assign(new Error("FFmpeg exited with code "+code),{result}));
      });
    });
  }
  cancel(jobId){
    const p=this.running.get(jobId);if(!p)return false;
    p.kill("SIGTERM");return true;
  }
}
