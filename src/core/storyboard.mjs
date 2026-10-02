import { uid, now } from "./id.mjs";

export const SHOT_TYPES=Object.freeze(["establishing","wide","medium","close","extreme-close","over-shoulder","tracking","aerial","insert","reaction"]);
export const COVERAGE_SEQUENCE=Object.freeze(["establishing","wide","medium","close","reaction","insert"]);

function validDuration(value,fallback=4){
 const n=Number(value); return Number.isFinite(n)&&n>0?n:fallback;
}

export function createStoryboardShot(input={}){
 const type=input.type??"wide";
 if(!SHOT_TYPES.includes(type))throw new Error("Unknown shot type: "+type);
 return {id:input.id??uid("sbshot"),sceneId:input.sceneId??null,beatId:input.beatId??null,index:Number.isFinite(input.index)?input.index:0,type,visualPrompt:input.visualPrompt??"",motionPrompt:input.motionPrompt??"",camera:{...(input.camera??{})},duration:validDuration(input.duration),characterIds:[...(input.characterIds??[])],locationId:input.locationId??null,mediaId:input.mediaId??null,continuityRefs:[...(input.continuityRefs??[])],sourceRefs:[...(input.sourceRefs??[])],notes:input.notes??"",createdAt:input.createdAt??now()};
}

function beatType(beat,index){
 const text=String(beat?.purpose??beat?.description??beat?.title??"").toLowerCase();
 if(/reaction|fear|grief|joy|decision|emotion|realize|cry/.test(text)) return "reaction";
 if(/detail|prop|hand|eye|blood|stone|sword|object/.test(text)) return "insert";
 if(/chase|move|run|pursue|follow/.test(text)) return "tracking";
 if(/reveal|arrive|kingdom|army|mountain|sea|crowd|storm/.test(text)) return index%2?"aerial":"establishing";
 return COVERAGE_SEQUENCE[index%COVERAGE_SEQUENCE.length];
}

export function buildStoryboard(scene={}){
 const beats=Array.isArray(scene.beats)&&scene.beats.length?scene.beats:[{id:null,title:scene.title,description:scene.notes,duration:4}];
 return beats.map((beat,index)=>createStoryboardShot({
   sceneId:scene.id,beatId:beat.id,index,type:beatType(beat,index),
   duration:validDuration(beat.duration,index%3===0?5:index%3===1?3:4),
   visualPrompt:beat.description??beat.title??scene.notes,
   motionPrompt:beat.motion??"",
   characterIds:scene.characters,locationId:scene.locationId,
   continuityRefs:scene.continuityRefs,sourceRefs:scene.sourceRefs
 }));
}

export function auditStoryboard(shots=[]){
 const items=Array.isArray(shots)?shots:[];
 const durations=items.map(x=>validDuration(x.duration)).filter(Boolean);
 const types=new Set(items.map(x=>x.type));
 const characterless=items.filter(x=>(x.characterIds??[]).length===0&&["medium","close","reaction","over-shoulder"].includes(x.type)).map(x=>x.id);
 const missingSource=items.filter(x=>(x.sourceRefs??[]).length===0).map(x=>x.id);
 const blockers=[];
 if(items.length===0) blockers.push({code:"storyboard-empty"});
 if(types.size<2&&items.length>1) blockers.push({code:"coverage-flat",detail:"Use more than one shot type."});
 if(characterless.length) blockers.push({code:"character-coverage-missing",shotIds:characterless});
 if(missingSource.length) blockers.push({code:"shot-source-missing",shotIds:missingSource});
 return {ready:blockers.length===0,blockers,stats:{shots:items.length,shotTypes:types.size,minDuration:durations.length?Math.min(...durations):0,maxDuration:durations.length?Math.max(...durations):0,totalSeconds:durations.reduce((a,b)=>a+b,0)}};
}
