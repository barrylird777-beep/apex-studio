import { uid, now } from "./id.mjs";
export class CollaborationLog {
 constructor(){this.events=[];}
 append(input={}){const e={id:uid("collab"),actorId:input.actorId??"local",type:input.type??"edit",targetId:input.targetId??null,payload:input.payload??{},at:now()};this.events.push(e);return e;}
 list(){return [...this.events];}
}
