import { uid, now } from "./id.mjs";

export const DATE_MODES=Object.freeze(["cozy-night","movie-night","virtual-dinner","late-night-chat","adventure","celebration"]);
export const AFFECTION_STYLES=Object.freeze(["tender","playful","flirty","romantic","devoted"]);
export const PRESENCE_QUALITIES=Object.freeze(["attentive","spontaneous","reassuring","playful","affectionate"]);

export function createIntimacyProfile(input={}){
 const affection=input.affection??"romantic";
 const dateMode=input.dateMode??"cozy-night";
 if(!AFFECTION_STYLES.includes(affection)) throw new Error("Unknown affection style");
 if(!DATE_MODES.includes(dateMode)) throw new Error("Unknown date mode");
 return {
  id:input.id??uid("intimacy"),
  affection,
  dateMode,
  qualities:Array.isArray(input.qualities)?input.qualities.filter(x=>PRESENCE_QUALITIES.includes(x)):[...PRESENCE_QUALITIES],
  responsiveness:Number.isFinite(Number(input.responsiveness))?Math.max(0,Math.min(100,Number(input.responsiveness))):80,
  initiative:Number.isFinite(Number(input.initiative))?Math.max(0,Math.min(100,Number(input.initiative))):70,
  warmth:Number.isFinite(Number(input.warmth))?Math.max(0,Math.min(100,Number(input.warmth))):80,
  updatedAt:now()
 };
}

export class IntimacyManager{
 constructor(){this.profiles=new Map();this.moments=new Map();this.dateNights=new Map();}
 create(input={}){const p=createIntimacyProfile(input);this.profiles.set(p.id,p);return p;}
 get(id){return this.profiles.get(id)??null;}
 list(){return [...this.profiles.values()];}
 update(id,input={}){const old=this.require(id);const next=createIntimacyProfile({...old,...input,id:old.id});this.profiles.set(id,next);return next;}
 addMoment(profileId,input={}){this.require(profileId);const m={id:input.id??uid("intimacy-moment"),profileId,kind:input.kind??"memory",text:input.text??"",tags:Array.isArray(input.tags)?[...input.tags]:[],importance:Math.max(0,Math.min(1,Number(input.importance??.5))),at:now()};const list=this.moments.get(profileId)??[];list.push(m);this.moments.set(profileId,list);return m;}
 momentsFor(profileId){this.require(profileId);return [...(this.moments.get(profileId)??[])];}
 startDateNight(profileId,input={}){const p=this.require(profileId);const mode=input.mode??p.dateMode;if(!DATE_MODES.includes(mode))throw new Error("Unknown date mode");const d={id:uid("date-night"),profileId,mode,title:input.title??mode,startedAt:now(),active:true};this.dateNights.set(d.id,d);return d;}
 endDateNight(id){const d=this.dateNights.get(id);if(!d)throw new Error("Date night not found");d.active=false;d.endedAt=now();return d;}
 require(id){const p=this.get(id);if(!p)throw new Error("Intimacy profile not found");return p;}
 snapshot(){return {profiles:this.list(),moments:[...this.moments.entries()],dateNights:[...this.dateNights.values()]};}
 restore(s={}){for(const p of s.profiles??[])this.profiles.set(p.id,p);for(const [id,v] of s.moments??[])this.moments.set(id,v);for(const d of s.dateNights??[])this.dateNights.set(d.id,d);return this;}
}