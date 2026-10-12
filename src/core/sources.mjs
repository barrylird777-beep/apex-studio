import { uid, now } from "./id.mjs";

export const SOURCE_CLASSES = Object.freeze([
  "scripture","deuterocanon","second_temple","enochic","patristic","catholic","orthodox",
  "jewish_tradition","gnostic","ancient_near_east","historical","archaeological","scholarly",
  "mystical_esoteric","modern_interpretation","original_fiction"
]);

export function createSource(input={}){
  const sourceClass=input.sourceClass??"historical";
  if(!SOURCE_CLASSES.includes(sourceClass)) throw new Error("Unknown source class: "+sourceClass);
  return {id:input.id??uid("source"),title:input.title??"Untitled Source",sourceClass,author:input.author??null,date:input.date??null,tradition:input.tradition??null,canonicalStatus:input.canonicalStatus??"unknown",provenance:input.provenance??[],uri:input.uri??null,license:input.license??"unknown",notes:input.notes??"",createdAt:input.createdAt??now(),updatedAt:input.updatedAt??now()};
}

export class SourceRegistry {
 constructor(){this.sources=new Map();}
 add(input={}){const s=createSource(input);this.sources.set(s.id,s);return s;}
 get(id){return this.sources.get(id)??null;}
 list(){return [...this.sources.values()];}
 byClass(sourceClass){return this.list().filter(s=>s.sourceClass===sourceClass);}
 restore(items=[]){this.sources.clear();for(const s of items)this.sources.set(s.id,{...s});return this;}
}