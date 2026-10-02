import { uid, now } from "./id.mjs";

export const ESCALATION_LEVELS=Object.freeze(["friendly","affectionate","flirty","sensual"]);
export const INITIATION_MODES=Object.freeze(["user-led","balanced","companion-led"]);
export const SENSUAL_STYLES=Object.freeze(["tender","playful","teasing","romantic","confident"]);
export const PACING_MODES=Object.freeze(["slow","gradual","responsive","spontaneous"]);
export const SESSION_STATES=Object.freeze(["idle","active","paused","ended"]);
export const MOODS=Object.freeze(["cozy","playful","mischievous","romantic","bold","slow-burn"]);
export const ENERGY_LEVELS=Object.freeze(["calm","warm","lively","charged"]);
export const INTERACTION_CUES=Object.freeze(["compliment","tease","banter","challenge","affection","anticipation","date-night","check-in"]);

function assertChoice(list,value,label){if(!list.includes(value))throw new Error(`Unknown ${label}`);}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}

export function createAdaptiveProfile(input={}){
 const level=input.level??"affectionate";
 const initiation=input.initiation??"balanced";
 const style=input.style??"romantic";
 const pacing=input.pacing??"gradual";
 const mood=input.mood??"romantic";
 const energy=input.energy??"warm";
 assertChoice(ESCALATION_LEVELS,level,"escalation level");
 assertChoice(INITIATION_MODES,initiation,"initiation mode");
 assertChoice(SENSUAL_STYLES,style,"sensual style");
 assertChoice(PACING_MODES,pacing,"pacing mode");
 assertChoice(MOODS,mood,"mood");
 assertChoice(ENERGY_LEVELS,energy,"energy level");
 return {
  id:input.id??uid("adaptive"),level,initiation,style,pacing,mood,energy,
  userCanEscalate:Boolean(input.userCanEscalate??true),
  companionCanInitiate:Boolean(input.companionCanInitiate??true),
  consentRequired:Boolean(input.consentRequired??true),
  surpriseMode:Boolean(input.surpriseMode??false),
  maxLevel:input.maxLevel??"sensual",
  boundaries:{...input.boundaries},
  signals:{...input.signals},
  preferences:{...input.preferences},
  cues:{...input.cues},
  createdAt:input.createdAt??now(),updatedAt:now()
 };
}

export class AdaptiveIntimacyManager{
 constructor(){this.profiles=new Map();this.events=new Map();this.sessions=new Map();}

 create(input={}){const p=createAdaptiveProfile(input);this.profiles.set(p.id,p);return p;}
 get(id){return this.profiles.get(id)??null;}
 list(){return [...this.profiles.values()];}

 update(id,input={}){
  const current=this.require(id);
  const next=createAdaptiveProfile({...current,...input,id:current.id,
   boundaries:{...current.boundaries,...input.boundaries},
   signals:{...current.signals,...input.signals},
   preferences:{...current.preferences,...input.preferences},
   cues:{...current.cues,...input.cues}});
  this.profiles.set(id,next);return next;
 }

 setBoundary(id,key,value){const p=this.require(id);if(!key||typeof key!=="string")throw new Error("Boundary key is required");p.boundaries[key]=value;p.updatedAt=now();return p;}
 setPreference(id,key,value){const p=this.require(id);if(!key||typeof key!=="string")throw new Error("Preference key is required");p.preferences[key]=value;p.updatedAt=now();return p;}
 recordSignal(id,signal,value=true){const p=this.require(id);if(!signal||typeof signal!=="string")throw new Error("Signal is required");p.signals[signal]=Boolean(value);p.updatedAt=now();return this.event(id,"signal",{signal,value:Boolean(value)});}

 setMood(id,mood,reason="user-request"){const p=this.require(id);assertChoice(MOODS,mood,"mood");const previous=p.mood;p.mood=mood;p.updatedAt=now();return this.event(id,"mood",{from:previous,to:mood,reason});}
 setEnergy(id,energy,reason="adaptive"){const p=this.require(id);assertChoice(ENERGY_LEVELS,energy,"energy level");const previous=p.energy;p.energy=energy;p.updatedAt=now();return this.event(id,"energy",{from:previous,to:energy,reason});}
 setCue(id,cue,enabled=true){const p=this.require(id);assertChoice(INTERACTION_CUES,cue,"interaction cue");p.cues[cue]=Boolean(enabled);p.updatedAt=now();return p;}
 getCues(id){const p=this.require(id);return INTERACTION_CUES.filter(c=>p.cues[c]!==false);}

 transition(id,nextLevel,{consent=true,reason="user-request"}={}){
  const p=this.require(id);assertChoice(ESCALATION_LEVELS,nextLevel,"escalation level");
  if(ESCALATION_LEVELS.indexOf(nextLevel)>ESCALATION_LEVELS.indexOf(p.maxLevel))throw new Error("Requested level exceeds profile maximum");
  if(nextLevel!==p.level&&!p.userCanEscalate)throw new Error("User escalation is disabled");
  if(p.consentRequired&&!consent)throw new Error("Consent confirmation required");
  const previous=p.level;p.level=nextLevel;p.updatedAt=now();return this.event(id,"transition",{from:previous,to:nextLevel,reason});
 }

 adapt(id,{signal=null,positive=true,consent=false}={}){
  const p=this.require(id);
  if(signal)this.recordSignal(id,signal,positive);
  if(!positive)return {profile:p,changed:false,reason:"negative-or-neutral signal"};
  const rank=ESCALATION_LEVELS.indexOf(p.level);
  if(rank>=ESCALATION_LEVELS.indexOf(p.maxLevel)||!p.userCanEscalate||p.consentRequired&&!consent)return {profile:p,changed:false,reason:"no automatic level change"};
  const next=ESCALATION_LEVELS[rank+1];
  const event=this.transition(id,next,{consent:true,reason:"adaptive-positive-signal"});
  return {profile:p,changed:true,event};
 }

 suggestCue(id,{avoid=[]}={}){
  const p=this.require(id);
  const available=this.getCues(id).filter(c=>!avoid.includes(c));
  if(!available.length)return null;
  const preferred=p.preferences.preferredCue;
  const cue=available.includes(preferred)?preferred:available[0];
  return {cue,mood:p.mood,energy:p.energy,style:p.style,pacing:p.pacing,level:p.level};
 }

 startSession(id,media="chat"){const p=this.require(id);const session={id:uid("adaptive-session"),profileId:id,media,state:"active",startedAt:now(),updatedAt:now(),mood:p.mood,energy:p.energy};this.sessions.set(session.id,session);return session;}
 pauseSession(sessionId){const s=this.requireSession(sessionId);s.state="paused";s.updatedAt=now();return s;}
 resumeSession(sessionId){const s=this.requireSession(sessionId);s.state="active";s.updatedAt=now();return s;}
 endSession(sessionId){const s=this.requireSession(sessionId);s.state="ended";s.updatedAt=now();s.endedAt=now();return s;}
 session(id){this.require(id);return [...this.sessions.values()].filter(s=>s.profileId===id);}

 evaluate(id,{requestedLevel=null,consent=false}={}){
  const p=this.require(id);const rank=ESCALATION_LEVELS.indexOf(p.level);const requested=requestedLevel?ESCALATION_LEVELS.indexOf(requestedLevel):rank;const reasons=[];
  if(requested<0)reasons.push("unknown requested level");
  if(requested>ESCALATION_LEVELS.indexOf(p.maxLevel))reasons.push("requested level exceeds profile maximum");
  if(p.consentRequired&&!consent&&requested!==rank)reasons.push("consent required for level change");
  if(requested>rank&&!p.userCanEscalate)reasons.push("escalation disabled");
  return {allowed:reasons.length===0,current:p.level,requested:requestedLevel??p.level,reasons};
 }

 eventsFor(id){this.require(id);return [...this.events.values()].filter(e=>e.profileId===id);}
 event(profileId,type,data={}){const e={id:uid("adaptive-event"),profileId,type,...clone(data),at:now()};this.events.set(e.id,e);return e;}
 require(id){const p=this.get(id);if(!p)throw new Error("Adaptive intimacy profile not found");return p;}
 requireSession(id){const s=this.sessions.get(id);if(!s)throw new Error("Adaptive session not found");return s;}
 snapshot(){return {profiles:this.list(),events:[...this.events.values()],sessions:[...this.sessions.values()]};}
 restore(snapshot={}){for(const p of snapshot.profiles??[])this.profiles.set(p.id,p);for(const e of snapshot.events??[])this.events.set(e.id,e);for(const s of snapshot.sessions??[])this.sessions.set(s.id,s);return this;}
}
