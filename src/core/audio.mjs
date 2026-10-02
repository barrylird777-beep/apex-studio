import { uid, now } from "./id.mjs";

export const AUDIO_ROLES=Object.freeze(["narration","dialogue","music","ambience","sfx"]);

export function createAudioTrack(input={}){
 const role=input.role??"narration";
 if(!AUDIO_ROLES.includes(role))throw new Error("Unknown audio role: "+role);
 return {id:input.id??uid("audio"),role,name:input.name??"Untitled audio",mediaId:input.mediaId??null,sourceId:input.sourceId??null,start:Number.isFinite(input.start)?input.start:0,duration:Number.isFinite(input.duration)?input.duration:0,volume:Number.isFinite(input.volume)?input.volume:1,fadeIn:Number.isFinite(input.fadeIn)?input.fadeIn:0,fadeOut:Number.isFinite(input.fadeOut)?input.fadeOut:0,text:input.text??"",language:input.language??"en",createdAt:input.createdAt??now()};
}
