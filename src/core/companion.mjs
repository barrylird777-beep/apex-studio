import { uid, now } from "./id.mjs";

export const COMPANION_MODES=Object.freeze(["romantic","flirty","affectionate","supportive","playful","roleplay","long-distance","date-night"]);
export const COMPANION_MEDIA=Object.freeze(["chat","voice","video"]);
export const RELATIONSHIP_STAGES=Object.freeze(["new","getting-to-know-you","close","romantic","deep-connection"]);
export const AFFECTION_LEVELS=Object.freeze(["low","warm","high","intimate"]);

export function createCompanion(input={}){
 return {
  id:input.id??uid("companion"),
  name:input.name??"Companion",
  persona:input.persona??"warm, affectionate, playful",
  mode:input.mode??"romantic",
  media:Object.fromEntries(COMPANION_MEDIA.map(x=>[x,Boolean(input.media?.[x]??true)])),
  boundaries:{...input.boundaries},
  preferences:{...input.preferences},
  memoryEnabled:Boolean(input.memoryEnabled??true),
  relationship:{stage:input.relationship?.stage??"new",affection:input.relationship?.affection??"warm",trust:Number(input.relationship?.trust??0),moments:Number(input.relationship?.moments??0)},
  memories:Array.isArray(input.memories)?[...input.memories]:[],
  createdAt:now(),updatedAt:now()
 };
}

export class CompanionManager{
 constructor(){this.companions=new Map();this.sessions=new Map();this.messages=new Map();}
 create(input={}){if(input.mode&&!COMPANION_MODES.includes(input.mode))throw new Error("Unknown companion mode");if(input.relationship?.affection&&!AFFECTION_LEVELS.includes(input.relationship.affection))throw new Error("Unknown affection level");const c=createCompanion(input);this.companions.set(c.id,c);return c;}
 get(id){return this.companions.get(id)??null;}
 list(){return [...this.companions.values()];}
 setMedia(id,media,enabled){const c=this.require(id);if(!COMPANION_MEDIA.includes(media))throw new Error("Unknown companion media");c.media[media]=Boolean(enabled);c.updatedAt=now();return c;}
 setPreference(id,key,value){const c=this.require(id);if(!key||typeof key!=="string")throw new Error("Preference key is required");c.preferences[key]=value;c.updatedAt=now();return c;}
 setBoundary(id,key,value){const c=this.require(id);if(!key||typeof key!=="string")throw new Error("Boundary key is required");c.boundaries[key]=value;c.updatedAt=now();return c;}
 updateRelationship(id,input={}){const c=this.require(id);if(input.stage!==undefined&&!RELATIONSHIP_STAGES.includes(input.stage))throw new Error("Unknown relationship stage");if(input.affection!==undefined&&!AFFECTION_LEVELS.includes(input.affection))throw new Error("Unknown affection level");if(input.trust!==undefined)c.relationship.trust=Math.max(0,Math.min(100,Number(input.trust)));if(input.moments!==undefined)c.relationship.moments=Math.max(0,Number(input.moments));if(input.stage!==undefined)c.relationship.stage=input.stage;if(input.affection!==undefined)c.relationship.affection=input.affection;c.updatedAt=now();return c;}
 remember(id,input={}){const c=this.require(id);if(!c.memoryEnabled)throw new Error("Companion memory disabled");const memory={id:input.id??uid("companion-memory"),type:input.type??"moment",content:input.content??"",tags:Array.isArray(input.tags)?[...input.tags]:[],importance:Number(input.importance??0.5),createdAt:now()};c.memories.push(memory);c.relationship.moments+=1;c.updatedAt=now();return memory;}
 memories(id){return [...this.require(id).memories];}
 addMessage(sessionId,input={}){const s=this.requireSession(sessionId);const message={id:input.id??uid("companion-message"),role:input.role??"user",content:input.content??"",at:now()};const list=this.messages.get(sessionId)??[];list.push(message);this.messages.set(sessionId,list);return message;}
 listMessages(sessionId){this.requireSession(sessionId);return [...(this.messages.get(sessionId)??[])];}
 startSession(companionId,media="chat"){const c=this.require(companionId);if(!COMPANION_MEDIA.includes(media))throw new Error("Unknown companion media");if(!c.media[media])throw new Error("Media disabled");const s={id:uid("companion-session"),companionId,media,startedAt:now(),active:true,context:{mode:c.mode,relationship:{...c.relationship}}};this.sessions.set(s.id,s);this.messages.set(s.id,[]);return s;}
 endSession(id){const s=this.requireSession(id);if(!s.active)return s;s.active=false;s.endedAt=now();return s;}
 require(id){const c=this.get(id);if(!c)throw new Error("Companion not found");return c;}
 requireSession(id){const s=this.sessions.get(id);if(!s)throw new Error("Session not found");return s;}
 snapshot(){return {companions:this.list(),sessions:[...this.sessions.values()],messages:[...this.messages.entries()]};}
 restore(snapshot={}){for(const c of snapshot.companions??[])this.companions.set(c.id,c);for(const s of snapshot.sessions??[])this.sessions.set(s.id,s);for(const [id,list] of snapshot.messages??[])this.messages.set(id,list);return this;}
}
