import { uid, now } from "./id.mjs";
export class CollaborationLog {
 constructor(){this.events=[];}
 append(input={}){const e={id:input.id??uid("collab"),actorId:input.actorId??"local",type:input.type??"edit",targetId:input.targetId??null,payload:input.payload??{},at:input.at??now()};this.events.push(e);return e;}
 list(){return [...this.events];}
 restore(items=[]){this.events=items.map(e=>({...e,payload:{...(e.payload??{})}}));return this;}
}