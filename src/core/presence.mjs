import { uid, now } from "./id.mjs";

export const PRESENCE_STYLES=Object.freeze(["warm","playful","flirty","romantic","affectionate","date-night","long-distance"]);
export const INTIMACY_LEVELS=Object.freeze(["gentle","close","intimate"]);
export const PRESENCE_MEDIA=Object.freeze(["chat","voice","video"]);

export function createPresenceProfile(input={}){
 const style=input.style??"romantic";
 const intimacy=input.intimacy??"close";
 if(!PRESENCE_STYLES.includes(style)) throw new Error("Unknown presence style");
 if(!INTIMACY_LEVELS.includes(intimacy)) throw new Error("Unknown intimacy level");
 return {id:input.id??uid("presence"),style,intimacy,media:Object.fromEntries(PRESENCE_MEDIA.map(m=>[m,Boolean(input.media?.[m]??true)])),pace:input.pace??"natural",initiative:Boolean(input.initiative??true),affection:Boolean(input.affection??true),teasing:Boolean(input.teasing??true),createdAt:now(),updatedAt:now()};
}

export class PresenceManager{
 constructor(){this.profiles=new Map();this.active=new Map();}
 create(input={}){const p=createPresenceProfile(input);this.profiles.set(p.id,p);return p;}
 get(id){return this.profiles.get(id)??null;}
 list(){return [...this.profiles.values()];}
 update(id,input={}){const p=this.require(id);const next=createPresenceProfile({...p,...input,id:p.id,media:{...p.media,...input.media}});this.profiles.set(id,next);return next;}
 start(id,media="chat"){const p=this.require(id);if(!PRESENCE_MEDIA.includes(media))throw new Error("Unknown presence media");if(!p.media[media])throw new Error("Presence media disabled");const session={id:uid("presence-session"),profileId:id,media,startedAt:now(),active:true};this.active.set(session.id,session);return session;}
 stop(id){const s=this.active.get(id);if(!s)throw new Error("Presence session not found");s.active=false;s.endedAt=now();return s;}
 require(id){const p=this.get(id);if(!p)throw new Error("Presence profile not found");return p;}
 snapshot(){return {profiles:this.list(),active:[...this.active.values()]};}
 restore(snapshot={}){for(const p of snapshot.profiles??[])this.profiles.set(p.id,p);for(const s of snapshot.active??[])this.active.set(s.id,s);return this;}
}