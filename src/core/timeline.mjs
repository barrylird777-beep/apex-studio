import crypto from "node:crypto";

export class TimelineEngine {
  constructor() { this.timelines=new Map(); }
  create(name, parentId=null) {
    const id=crypto.randomUUID();
    const t={id,name,parentId,events:[],createdAt:new Date().toISOString()};
    this.timelines.set(id,t); return t;
  }
  addEvent(timelineId,event) {
    const t=this.timelines.get(timelineId); if(!t) throw new Error("Timeline not found");
    t.events.push({...event,id:event.id??crypto.randomUUID()});
    t.events.sort((a,b)=>(a.order??0)-(b.order??0)); return t.events.at(-1);
  }
  branch(parentId,name) {
    const parent=this.timelines.get(parentId); if(!parent) throw new Error("Parent timeline not found");
    const child=this.create(name,parentId);
    child.events=structuredClone(parent.events);
    return child;
  }
}
