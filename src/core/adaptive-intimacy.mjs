import { uid, now } from "./id.mjs";

export const ESCALATION_LEVELS=Object.freeze(["friendly","affectionate","flirty","sensual"]);
export const INITIATION_MODES=Object.freeze(["user-led","balanced","companion-led"]);
export const SENSUAL_STYLES=Object.freeze(["tender","playful","teasing","romantic","confident"]);
export const PACING_MODES=Object.freeze(["slow","gradual","responsive","spontaneous"]);
export const SESSION_STATES=Object.freeze(["idle","active","paused","ended"]);

export function createAdaptiveProfile(input={}){
 const level=input.level??"affectionate";
 const initiation=input.initiation??"balanced";
 const style=input.style??"romantic";
 const pacing=input.pacing??"gradual";
 if(!ESCALATION_LEVELS.includes(level))throw new Error("Unknown escalation level");
 if(!INITIATION_MODES.includes(initiation))throw new Error("Unknown initiation mode");
 if(!SENSUAL_STYLES.includes(style))throw new Error("Unknown sensual style");
 if(!PACING_MODES.includes(pacing))throw new Error("Unknown pacing mode");
 return {
  id:input.id??uid("adaptive"),level,initiation,style,pacing,
  userCanEscalate:Boolean(input.userCanEscalate??true),
  companionCanInitiate:Boolean(input.companionCanInitiate??true),
  consentRequired:Boolean(input.consentRequired??true),
  boundaries:{...input.boundaries},
  signals:{...input.signals},
  preferences:{...input.preferences},
  createdAt:input.createdAt??now(),updatedAt:now()
 };
}

export class AdaptiveIntimacyManager{
 constructor(){this.profiles=new Map();this.events=new Map();this.sessions=new Map();}
 create(input={}){const p=createAdaptiveProfile(input);this.profiles.set(p.id,p);return p;}
 get(id){return this.profiles.get(id)??null;}
 list(){return [...this.profiles.values()];}
 update(id,input={}){const current=this.require(id);const next=createAdaptiveProfile({...current,...input,id:current.id,boundaries:{...current.boundaries,...input.boundaries},signals:{...current.signals,...input.signals},preferences:{...current.preferences,...input.preferences}});this.profiles.set(id,next);return next;}
 setBoundary(id,key,value){const p=this.require(id);if(!key||typeof key!=="string")throw new Error("Boundary key is required");p.boundaries[key]=value;p.updatedAt=now();return p;}
 setPreference(id,key,value){const p=this.require(id);if(!key||typeof key!=="string")throw new Error("Preference key is required");p.preferences[key]=value;p.updatedAt=now();return p;}
 recordSignal(id,signal,value=true){const p=this.require(id);if(!signal||typeof signal!=="string")throw new Error("Signal is required");p.signals[signal]=Boolean(value);p.updatedAt=now();return p;}
 transition(id,nextLevel,{consent=true,reason="user-request"}={}){const p=this.require(id);if(!ESCALATION_LEVELS.includes(nextLevel))throw new Error("Unknown escalation level");if(nextLevel!==p.level&&!p.userCanEscalate)throw new Error("User escalation is disabled");if(p.consentRequired&&!consent)throw new Error("Consent confirmation required");const previous=p.level;p.level=nextLevel;p.updatedAt=now();return this.event(id,"transition",{from:previous,to:nextLevel,reason});}
 startSession(id,media="chat"){const p=this.require(id);const session={id:uid("adaptive-session"),profileId:id,media,state:"active",startedAt:now(),updatedAt:now()};this.sessions.set(session.id,session);return session;}
 pauseSession(sessionId){const s=this.requireSession(sessionId);s.state="paused";s.updatedAt=now();return s;}
 resumeSession(sessionId){const s=this.requireSession(sessionId);s.state="active";s.updatedAt=now();return s;}
 endSession(sessionId){const s=this.requireSession(sessionId);s.state="ended";s.updatedAt=now();s.endedAt=now();return s;}
 session(id){this.require(id);return [...this.sessions.values()].filter(s=>s.profileId===id);}
 evaluate(id,{requestedLevel=null,consent=false}={}){const p=this.require(id);const rank=ESCALATION_LEVELS.indexOf(p.level);const requested=requestedLevel?ESCALATION_LEVELS.indexOf(requestedLevel):rank;const reasons=[];if(requested<0)reasons.push("unknown requested level");if(p.consentRequired&&!consent&&requested!==rank)reasons.push("consent required for level change");if(requested>rank&&!p.userCanEscalate)reasons.push("escalation disabled");return {allowed:reasons.length===0,current:p.level,requested:requestedLevel??p.level,reasons};}
 eventsFor(id){this.require(id);return [...this.events.values()].filter(e=>e.profileId===id);}
 event(profileId,type,data={}){const e={id:uid("adaptive-event"),profileId,type,...data,at:now()};this.events.set(e.id,e);return e;}
 require(id){const p=this.get(id);if(!p)throw new Error("Adaptive intimacy profile not found");return p;}
 requireSession(id){const s=this.sessions.get(id);if(!s)throw new Error("Adaptive session not found");return s;}
 snapshot(){return {profiles:this.list(),events:[...this.events.values()],sessions:[...this.sessions.values()]};}
 restore(snapshot={}){for(const p of snapshot.profiles??[])this.profiles.set(p.id,p);for(const e of snapshot.events??[])this.events.set(e.id,e);for(const s of snapshot.sessions??[])this.sessions.set(s.id,s);return this;}
}
