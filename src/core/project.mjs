import { uid, now } from "./id.mjs";

export function createProject(input={}){
  const name=String(input.name??"").trim();
  if(!name) throw new TypeError("name is required");
  return {
    id:input.id??uid("proj"),
    name,
    description:input.description??"",
    version:"5.2.0",
    createdAt:input.createdAt??now(),
    updatedAt:now(),
    settings:{...input.settings},
    tags:[...(input.tags??[])],
    state:input.state??"active",
    contentType:"bible-video"
  };
}

export class ProjectStore {
  constructor(){this.projects=new Map();}
  create(input){const p=createProject(input);this.projects.set(p.id,p);return p;}
  upsert(p){p.updatedAt=now();this.projects.set(p.id,p);return p;}
  get(id){return this.projects.get(id)??null;}
  list(){return [...this.projects.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
}
