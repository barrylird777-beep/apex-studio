import { uid, now } from "./id.mjs";

export const ESCALATION_LEVELS=Object.freeze(["friendly","affectionate","flirty","sensual"]);
export const INITIATION_MODES=Object.freeze(["user-led","balanced","companion-led"]);
export const SENSUAL_STYLES=Object.freeze(["tender","playful","teasing","romantic","confident"]);

export function createAdaptiveProfile(input={}){
 const level=input.level??"affectionate";
 const initiation=input.initiation??"balanced";
 const style=input.style??"romantic";
 if(!ESCALATION_LEVELS.includes(level)) throw new Error("Unknown escalation level");
 if(!INITIATION_MODES.includes(initiation)) throw new Error("Unknown initiation mode");
 if(!SENSUAL_STYLES.includes(style)) throw new Error("Unknown sensual style");
 return {
  id:input.id??uid("adaptive"),
  level,
  initiation,
  style,
  pacing:input.pacing??"gradual",
  userCanEscalate:Boolean(input.userCanEscalate??true),
  consentRequired:Boolean(input.consentRequired??true),
  boundaries:{...input.boundaries},
  signals:{...input.signals},
  createdAt:input.createdAt??now(),
  updatedAt:now()
 };
}

export class AdaptiveIntimacyManager{
 constructor(){this.profiles=new Map();this.events=new Map();}
 create(input={}){const p=createAdaptiveProfile(input);this.profiles.set(p.id,p);return p;}
 get(id){return this.profiles.get(id)??null;}
 list(){return [...this.profiles.values()];}
 update(id,input={}){const current=this.require(id);const next=createAdaptiveProfile({...current,...input,id:current.id,boundaries:{...current.boundaries,...input.boundaries},signals:{...current.signals,...input.signals}});this.profiles.set(id,next);return next;}
 setBoundary(id,key,value){const p=this.require(id);if(!key||typeof key!=="string")throw new Error("Boundary key is required");p.boundaries[key]=value;p.updatedAt=now();return p;}
 transition(id,nextLevel,{consent=true,reason="user-request"}={}){const p=this.require(id);if(!ESCALATION_LEVELS.includes(nextLevel))throw new Error("Unknown escalation level");if(!p.userCanEscalate&&nextLevel!==p.level)throw new Error("User escalation is disabled");if(p.consentRequired&&!consent)throw new Error("Consent confirmation required");const previous=p.level;p.level=nextLevel;p.updatedAt=now();const event={id:uid("adaptive-event"),profileId:id,from:previous,to:nextLevel,reason,at:now()};this.events.set(event.id,event);return {profile:p,event};}
 recordSignal(id,signal,value=true){const p=this.require(id);if(!signal||typeof signal!=="string")throw new Error("Signal is required");p.signals[signal]=Boolean(value);p.updatedAt=now();return p;}
 eventsFor(id){this.require(id);return [...this.events.values()].filter(e=>e.profileId===id);}
 require(id){const p=this.get(id);if(!p)throw new Error("Adaptive intimacy profile not found");return p;}
 snapshot(){return {profiles:this.list(),events:[...this.events.values()]};}
 restore(snapshot={}){for(const p of snapshot.profiles??[])this.profiles.set(p.id,p);for(const e of snapshot.events??[])this.events.set(e.id,e);return this;}
}
