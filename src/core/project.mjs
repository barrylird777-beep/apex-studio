import { uid, now } from "./id.mjs";
export function createProject(input={}){
 const name=String(input.name??"").trim();if(!name)throw new TypeError("name is required");
 return {id:input.id??uid("proj"),name,description:input.description??"",version:"5.3.0",createdAt:input.createdAt??now(),updatedAt:now(),settings:{...input.settings},tags:[...(input.tags??[])],state:input.state??"active",contentType:"bible-video"};
}
export class ProjectStore{
 constructor(){this.projects=new Map();}
 create(input){const p=createProject(input);this.projects.set(p.id,p);return p;}
 upsert(p){const next={...p,updatedAt:now()};this.projects.set(p.id,next);return next;}
 get(id){return this.projects.get(id)??null;}
 list(){return [...this.projects.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 snapshot(){return this.list();}
 restore(items=[]){this.projects.clear();for(const p of items)this.projects.set(p.id,{...p});return this;}
}
