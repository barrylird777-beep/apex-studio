import { uid, now } from "./id.mjs";

export const SCENE_PURPOSES=Object.freeze([
 "setup","desire","conflict","escalation","reversal","crisis","payoff","meaning","transition","reveal"
]);

function text(v){return String(v??"").trim();}

export function createSceneBlueprint(input={}){
 const title=text(input.title); if(!title) throw new TypeError("scene title is required");
 const purpose=text(input.purpose)||"transition";
 if(!SCENE_PURPOSES.includes(purpose)) throw new TypeError("Unknown scene purpose");
 return {
  id:input.id??uid("scene-plan"),title,purpose,question:text(input.question),
  conflict:text(input.conflict),turn:text(input.turn),payoff:text(input.payoff),
  sourceRefs:[...(input.sourceRefs??[])],characterIds:[...(input.characterIds??[])],
  locationId:input.locationId??null,beats:[...(input.beats??[])],createdAt:input.createdAt??now()
 };
}

export function auditScenes(scenes=[]){
 const items=Array.isArray(scenes)?scenes:[];
 const blockers=[];
 const missingPurpose=items.filter(x=>!SCENE_PURPOSES.includes(x.purpose)).map(x=>x.id);
 const emptyPurpose=items.filter(x=>!text(x.question)&&!text(x.conflict)&&!text(x.turn)&&!text(x.payoff)).map(x=>x.id);
 const sourceMissing=items.filter(x=>(x.sourceRefs??[]).length===0).map(x=>x.id);
 const purposes=new Set(items.map(x=>x.purpose));
 if(!items.length) blockers.push({code:"scenes-empty"});
 if(missingPurpose.length) blockers.push({code:"scene-purpose-invalid",sceneIds:missingPurpose});
 if(emptyPurpose.length) blockers.push({code:"scene-purpose-missing",sceneIds:emptyPurpose});
 if(sourceMissing.length) blockers.push({code:"scene-source-missing",sceneIds:sourceMissing});
 return {ready:blockers.length===0,blockers,stats:{scenes:items.length,purposes:[...purposes]}};
}
