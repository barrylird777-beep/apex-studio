import { uid, now } from "../core/id.mjs";
export class WorldState {
 constructor(){this.facts=new Map();this.events=[];}
 set(key,value,source="studio"){const fact={id:uid("fact"),key,value,source,updatedAt:now()};this.facts.set(key,fact);return fact;}
 get(key){return this.facts.get(key)?.value;}
 apply(event){this.events.push({...event,id:event.id??uid("evt"),appliedAt:now()});for(const change of event.changes??[])this.set(change.key,change.value,event.id);return this.events.at(-1);}
 snapshot(){return {facts:Object.fromEntries([...this.facts].map(([k,v])=>[k,v.value])),events:structuredClone(this.events)};}
}
