import { uid, now } from "./id.mjs";
import { diagnoseEpisode } from "./production-doctor.mjs";
import { directorDecision } from "./autonomous-director.mjs";

export const JOB_STATES=Object.freeze(["queued","running","succeeded","failed","blocked","cancelled"]);
export const JOB_TYPES=Object.freeze(["research","truth","story","script","scenes","storyboard","visuals","audio","timeline","review","release"]);

const arr=v=>Array.isArray(v)?v:[];
const severityRank={blocker:0,warning:1,info:2};

export function createProductionJob(input={}){
 return {
  id:input.id??uid("job"),
  episodeId:input.episodeId??null,
  type:input.type??"review",
  state:input.state??"queued",
  attempts:input.attempts??0,
  maxAttempts:input.maxAttempts??3,
  dependencies:arr(input.dependencies),
  input:input.input??{},
  output:input.output??null,
  errors:arr(input.errors),
  validation:input.validation??null,
  createdAt:input.createdAt??now(),
  updatedAt:now()
 };
}

export function planProductionJobs({episode={},canon={},characters=[],previousCharacters=[]}={}){
 const diagnosis=diagnoseEpisode({episode,canon,characters,previousCharacters});
 const jobs=[];
 for(const repair of arr(diagnosis.repairs)){
  jobs.push(createProductionJob({
   episodeId:episode.id,
   type:repair.action.replace(/^repair /,"").replaceAll(" ","-"),
   dependencies:repair.dependencies,
   input:{action:repair.action}
  }));
 }
 return {episodeId:episode.id??null,diagnosisId:diagnosis.id,jobs,blocked:diagnosis.findings.filter(x=>x.severity==="blocker"),createdAt:now()};
}

export function runnableJobs(plan={},completedIds=[]){
 const done=new Set(arr(completedIds));
 return arr(plan.jobs).filter(job=>job.state==="queued"&&arr(job.dependencies).every(dep=>done.has(dep)||arr(plan.jobs).some(other=>other.id===dep&&other.state==="succeeded")));
}

export function startJob(job={}){
 if(job.state!=="queued") return job;
 return {...job,state:"running",attempts:(job.attempts??0)+1,updatedAt:now()};
}

export function completeJob(job={},output=null,validation={ready:true}){
 if(!validation.ready) return failJob(job,{code:"validation-failed",message:"Output failed validation."});
 return {...job,state:"succeeded",output,validation,updatedAt:now()};
}

export function failJob(job={},error={}){
 const attempts=job.attempts??0;
 return {...job,state:attempts<(job.maxAttempts??3)?"queued":"failed",errors:[...arr(job.errors),{...error,at:now()}],updatedAt:now()};
}

export function blockPlan(plan={},reason="Quality gate blocked"){
 return {...plan,jobs:arr(plan.jobs).map(job=>job.state==="queued"?{...job,state:"blocked",updatedAt:now()}:job),blocked:[...arr(plan.blocked),{code:"plan-blocked",message:reason}]};
}

export function orchestratorDecision(input={}){
 const diagnosis=diagnoseEpisode(input);
 if(diagnosis.findings.some(x=>x.severity==="blocker")) return {decision:"repair",diagnosisId:diagnosis.id};
 return directorDecision({plan:{actions:[],blocked:[]},stage:input.episode?.stage});
}

export function auditProductionPlan(plan={}){
 const jobs=arr(plan.jobs);
 const invalid=jobs.filter(job=>!JOB_STATES.includes(job.state)||!job.id||!job.episodeId);
 const failed=jobs.filter(job=>job.state==="failed");
 const running=jobs.filter(job=>job.state==="running");
 return {ready:invalid.length===0&&failed.length===0,invalid,failed,running,stats:{jobs:jobs.length,failed:failed.length,running:running.length}};
}
