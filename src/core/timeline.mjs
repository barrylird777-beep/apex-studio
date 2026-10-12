import crypto from "node:crypto";

export class TimelineEngine {
  constructor() { this.timelines=new Map(); }

  create(name="Untitled Timeline", parentId=null) {
    const id=crypto.randomUUID();
    const t={id,name,parentId,events:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    this.timelines.set(id,t);
    return t;
  }

  get(id){return this.timelines.get(id)??null;}
  list(){return [...this.timelines.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}

  addEvent(timelineId,event={}) {
    const t=this.get(timelineId); if(!t) throw new Error("Timeline not found");
    const item={...event,id:event.id??crypto.randomUUID(),order:Number.isFinite(event.order)?event.order:t.events.length};
    t.events.push(item);
    t.events.sort((a,b)=>(a.order??0)-(b.order??0));
    t.updatedAt=new Date().toISOString();
    return item;
  }

  branch(parentId,name="Branch") {
    const parent=this.get(parentId); if(!parent) throw new Error("Parent timeline not found");
    const child=this.create(name,parentId);
    child.events=structuredClone(parent.events);
    child.updatedAt=new Date().toISOString();
    return child;
  }

  snapshot(){return this.list();}
  restore(items=[]){this.timelines.clear();for(const t of items)this.timelines.set(t.id,structuredClone(t));return this;}
}
