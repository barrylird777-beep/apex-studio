import { uid, now } from "./id.mjs";
import path from "node:path";

export const MEDIA_TYPES=Object.freeze(["image","video","audio","subtitle"]);

export function createMedia(input={}){
  const type=input.type??"image";
  if(!MEDIA_TYPES.includes(type)) throw new Error("Unknown media type: "+type);
  return {id:input.id??uid("media"),type,uri:input.uri??null,mime:input.mime??null,name:input.name??"Untitled media",duration:Number.isFinite(input.duration)?input.duration:0,width:input.width??null,height:input.height??null,sourceId:input.sourceId??null,license:input.license??"unknown",sha256:input.sha256??null,metadata:{...(input.metadata??{})},createdAt:input.createdAt??now(),updatedAt:now()};
}

export class MediaRegistry{
 constructor(){this.media=new Map();}
 add(input){const m=createMedia(input);this.media.set(m.id,m);return m;}
 get(id){return this.media.get(id)??null;}
 list(){return [...this.media.values()];}
 remove(id){return this.media.delete(id);}
 snapshot(){return this.list();}
 restore(items=[]){this.media.clear();for(const m of items)this.media.set(m.id,{...m,metadata:{...(m.metadata??{})}});return this;}
 resolveLocal(uri){if(!uri)return null;return path.resolve(uri);}
}
