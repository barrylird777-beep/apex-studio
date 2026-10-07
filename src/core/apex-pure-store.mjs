import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ApexRingWAL } from "./apex-ring-wal.mjs";

const ROOT=process.env.APEX_SE_X_ROOT||"/srv/apex/se-x";
const PROJECTS=process.env.APEX_PROJECTS_DIR||path.join(ROOT,"projects");
const wal=new ApexRingWAL();
const clone=v=>v==null?v:JSON.parse(JSON.stringify(v));
const key=v=>String(v);
const safe=v=>key(v).replace(/[^a-zA-Z0-9._-]/g,"_");

export class ApexPureStore {
 constructor({projectsDir=PROJECTS,ring=wal}={}){this.projectsDir=projectsDir;this.ring=ring;this.cache=new Map();this.ready=false;}
 async init(){if(this.ready)return this;await mkdir(this.projectsDir,{recursive:true});await this.ring.init();await this.ring.replay({onRecord:r=>this.apply(r)});this.ready=true;return this;}
 statePath(id){return path.join(this.projectsDir,safe(id),"state.json");}
 async atomicJson(file,value){await mkdir(path.dirname(file),{recursive:true});const tmp=file+"."+process.pid+"."+randomUUID()+".tmp";await writeFile(tmp,JSON.stringify(value,null,2)+"\n","utf8");await rename(tmp,file);}
 async apply(r){if(r.type==="project.put")this.cache.set(key(r.payload.id),clone(r.payload.state));if(r.type==="project.delete")this.cache.delete(key(r.payload.id));if(r.type==="job.enqueue"||r.type==="job.claim"||r.type==="job.heartbeat"||r.type==="job.complete"||r.type==="job.fail"||r.type==="job.defer")this.cache.set("_job:"+key(r.payload.id),{_job:clone(r.payload)});}
 async putProject(id,state={},opts={}){await this.init();const k=key(id),cur=this.cache.get(k),v=Number(cur?._version||0);if(opts.expectedVersion!=null&&Number(opts.expectedVersion)!==v){const e=new Error("Apex state version conflict");e.code="VERSION_CONFLICT";e.expected=Number(opts.expectedVersion);e.actual=v;throw e;}const next={...clone(state),_version:v+1,_updatedAt:new Date().toISOString()};const r=await this.ring.append("project.put",{id:k,state:next});await this.apply(r);await this.atomicJson(this.statePath(k),next);return clone(next);}
 async getProject(id){await this.init();const k=key(id);if(this.cache.has(k))return clone(this.cache.get(k));try{return JSON.parse(await readFile(this.statePath(k),"utf8"))}catch{return null;}}
 async deleteProject(id){await this.init();const r=await this.ring.append("project.delete",{id:key(id)});await this.apply(r);return true;}
 jobs(){return [...this.cache.values()].map(v=>v?._job).filter(Boolean);}
 async enqueue(task={}){await this.init();const id=key(task.id||randomUUID()),dedupe=task.dedupeKey?key(task.dedupeKey):null;if(dedupe){const x=this.jobs().find(j=>j.dedupeKey===dedupe&&["queued","running"].includes(j.status));if(x)return {...clone(x),duplicate:true};}const j={id,type:key(task.type||task.task||"generic"),payload:clone(task.payload||{}),status:"queued",attempts:0,maxAttempts:Math.max(1,Number(task.maxAttempts||5)),runAt:Number(task.runAt||Date.now()),dedupeKey:dedupe,leaseOwner:null,leaseToken:null,leaseFence:0,leaseExpiresAt:0,createdAt:Date.now(),updatedAt:Date.now()};const r=await this.ring.append("job.enqueue",j);await this.apply(r);return clone(j);}
 async claim({workerId="local",limit=1,leaseMs=45000,role=null}={}){await this.init();const now=Date.now(),owner=key(workerId),out=[];const list=this.jobs().filter(j=>j.status==="queued"&&j.runAt<=now&&j.attempts<j.maxAttempts).filter(j=>!role||j.payload?._apex_worker?.role===role).sort((a,b)=>(b.priority||0)-(a.priority||0)||a.runAt-b.runAt||a.createdAt-b.createdAt);for(const j of list.slice(0,Math.max(1,Number(limit)||1))){const n={...j,status:"running",attempts:j.attempts+1,leaseOwner:owner,leaseToken:randomUUID(),leaseFence:j.leaseFence+1,leaseExpiresAt:now+leaseMs,updatedAt:now};const r=await this.ring.append("job.claim",n,{workerId:owner});await this.apply(r);out.push(clone(n));}return out;}
 async transition(id,action,data={}){await this.init();const j=this.jobs().find(x=>x.id===key(id));if(!j)return false;if(data.leaseToken&&j.leaseToken!==data.leaseToken)return false;if(data.leaseFence!=null&&j.leaseFence!==Number(data.leaseFence))return false;if(action==="heartbeat"&&j.leaseExpiresAt<=Date.now())return false;const n={...j};if(action==="heartbeat")n.leaseExpiresAt=Date.now()+Math.max(100,Number(data.leaseMs)||45000);if(action==="complete"){n.status="completed";n.result=clone(data.result);n.leaseOwner=n.leaseToken=n.leaseExpiresAt=null;}if(action==="fail"){n.lastError=String(data.error||"Worker task failed").slice(0,4000);n.status=n.attempts>=n.maxAttempts?"dead":"queued";n.runAt=n.status==="queued"?Date.now()+Math.min(300000,Math.pow(2,n.attempts)*1000+Math.floor(Math.random()*5000)):n.runAt;n.leaseOwner=n.leaseToken=n.leaseExpiresAt=null;}if(action==="defer"){n.status="queued";n.runAt=Date.now()+Math.max(100,Number(data.delayMs)||1000);n.leaseOwner=n.leaseToken=n.leaseExpiresAt=null;}const r=await this.ring.append("job."+action,n);await this.apply(r);return true;}
 async recoverExpired(limit=500){await this.init();let c=0;for(const j of this.jobs().filter(x=>x.status==="running"&&x.leaseExpiresAt<Date.now()).slice(0,limit)){if(await this.transition(j.id,"fail",{leaseToken:j.leaseToken,leaseFence:j.leaseFence,error:"Worker lease expired"}))c++;}return c;}
 async snapshot(){await this.init();return{root:ROOT,projects:[...this.cache.keys()].filter(k=>!k.startsWith("_job:")).length,jobs:this.jobs().length,sequence:this.ring.sequence};}
}
export const apexPureStore=new ApexPureStore();
export {ROOT as APEX_SE_X_ROOT,PROJECTS as APEX_PROJECTS_DIR};