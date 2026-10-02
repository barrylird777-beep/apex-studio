import { uid, now } from "./id.mjs";

const arr=v=>Array.isArray(v)?v:[];

export const ARTIFACT_TYPES=Object.freeze(["source","analysis","story","script","scene","shot","visual","audio","timeline","review","release"]);

export function createArtifact(input={}){
 return {
  id:input.id??uid("artifact"),
  episodeId:input.episodeId??null,
  type:input.type??"review",
  version:input.version??1,
  status:input.status??"draft",
  content:input.content??null,
  sourceRefs:arr(input.sourceRefs),
  parentArtifactIds:arr(input.parentArtifactIds),
  jobId:input.jobId??null,
  model:input.model??null,
  generator:input.generator??null,
  checks:arr(input.checks),
  metadata:input.metadata??{},
  createdAt:input.createdAt??now(),
  updatedAt:now()
 };
}

export function addArtifactCheck(artifact={},check={}){
 return {...artifact,checks:[...arr(artifact.checks),{id:check.id??uid("check"),name:String(check.name??"validation"),ok:Boolean(check.ok),message:String(check.message??""),createdAt:now()}],updatedAt:now()};
}

export function validateArtifact(artifact={}){
 const checks=arr(artifact.checks);
 const failures=checks.filter(check=>!check.ok);
 const provenance=arr(artifact.sourceRefs).length>0;
 return {
  ready:failures.length===0&&provenance,
  failures,
  provenance,
  stats:{checks:checks.length,failures:failures.length}
 };
}

export function promoteArtifact(artifact={},targetStatus="approved"){
 const validation=validateArtifact(artifact);
 if(!validation.ready) return {...artifact,status:"blocked",updatedAt:now(),validation};
 return {...artifact,status:targetStatus,version:(artifact.version??1)+1,updatedAt:now(),validation};
}

export function artifactLineage(artifact={},artifacts=[]){
 const byId=new Map(arr(artifacts).map(item=>[item.id,item]));
 const lineage=[];
 const visit=id=>{const item=byId.get(id);if(!item||lineage.some(x=>x.id===id))return;lineage.push(item);for(const parent of arr(item.parentArtifactIds))visit(parent);};
 visit(artifact.id);
 return lineage;
}

export function auditArtifactGraph(artifacts=[]){
 const list=arr(artifacts);
 const ids=new Set(list.map(x=>x.id));
 const blockers=[];
 for(const artifact of list){
  for(const parent of arr(artifact.parentArtifactIds)){
   if(!ids.has(parent)) blockers.push({code:"missing-parent-artifact",artifactId:artifact.id,parentArtifactId:parent});
  }
  if(!artifact.sourceRefs?.length) blockers.push({code:"artifact-provenance-missing",artifactId:artifact.id});
 }
 return {ready:blockers.length===0,blockers,stats:{artifacts:list.length,blockers:blockers.length}};
}
