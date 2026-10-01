import { uid, now } from "./id.mjs";
export class RenderQueue {
 constructor(){this.jobs=new Map();}
 enqueue(input={}){const j={id:uid("render"),status:"queued",sceneId:input.sceneId??null,shotIds:input.shotIds??[],format:input.format??"master",settings:input.settings??{},createdAt:now()};this.jobs.set(j.id,j);return j;}
 get(id){return this.jobs.get(id)??null;} list(){return [...this.jobs.values()];}
 mark(id,status,patch={}){const j=this.get(id);if(!j)throw new Error("Render job not found");Object.assign(j,patch,{status,updatedAt:now()});return j;}
}
