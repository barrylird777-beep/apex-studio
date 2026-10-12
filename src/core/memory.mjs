import { uid, now } from "./id.mjs";
export class MemoryStore {
 constructor(){this.items=[];}
 remember(input){const item={id:uid("mem"),type:"note",importance:0.5,createdAt:now(),...input};this.items.push(item);return item;}
 search(query,{projectId,limit=12}={}){const q=String(query).toLowerCase();return this.items.filter(x=>(!projectId||x.projectId===projectId)&&JSON.stringify(x).toLowerCase().includes(q)).sort((a,b)=>b.importance-a.importance).slice(0,limit);}
 forProject(projectId){return this.items.filter(x=>x.projectId===projectId);}
}
