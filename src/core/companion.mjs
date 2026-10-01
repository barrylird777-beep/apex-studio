import { uid, now } from "./id.mjs";

export const COMPANION_MODES=Object.freeze(["romantic","flirty","affectionate","supportive","playful","roleplay","long-distance","date-night"]);
export const COMPANION_MEDIA=Object.freeze(["chat","voice","video"]);
export function createCompanion(input={}){
 return {id:input.id??uid("companion"),name:input.name??"Companion",persona:input.persona??"warm, affectionate, playful",mode:input.mode??"romantic",media:Object.fromEntries(COMPANION_MEDIA.map(x=>[x,Boolean(input.media?.[x]??true)])),boundaries:{...input.boundaries},memoryEnabled:Boolean(input.memoryEnabled??true),createdAt:now(),updatedAt:now()};
}
export class CompanionManager{
 constructor(){this.companions=new Map();this.sessions=new Map();}
 create(input={}){if(input.mode&&!COMPANION_MODES.includes(input.mode))throw new Error("Unknown companion mode");const c=createCompanion(input);this.companions.set(c.id,c);return c;}
 get(id){return this.companions.get(id)??null;}
 list(){return [...this.companions.values()];}
 setMedia(id,media,enabled){const c=this.get(id);if(!c)throw new Error("Companion not found");if(!COMPANION_MEDIA.includes(media))throw new Error("Unknown companion media");c.media[media]=Boolean(enabled);c.updatedAt=now();return c;}
 startSession(companionId,media="chat"){const c=this.get(companionId);if(!c)throw new Error("Companion not found");if(!c.media[media])throw new Error("Media disabled");const s={id:uid("companion-session"),companionId,media,startedAt:now(),active:true};this.sessions.set(s.id,s);return s;}
 endSession(id){const s=this.sessions.get(id);if(!s)throw new Error("Session not found");s.active=false;s.endedAt=now();return s;}
 snapshot(){return {companions:this.list(),sessions:[...this.sessions.values()]};}
 restore(snapshot={}){for(const c of snapshot.companions??[])this.companions.set(c.id,c);for(const s of snapshot.sessions??[])this.sessions.set(s.id,s);return this;}
}
