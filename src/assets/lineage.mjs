import { uid, now } from "../core/id.mjs";
export class AssetRegistry {
 constructor(){this.assets=new Map();}
 create(input={}){const a={id:input.id??uid("asset"),kind:input.kind??"unknown",name:input.name??"Untitled Asset",status:"draft",version:1,parents:input.parents??[],spec:input.spec??{},metadata:input.metadata??{},createdAt:now(),updatedAt:now()};this.assets.set(a.id,a);return a;}
 revise(id,patch={}){const prev=this.assets.get(id);if(!prev)throw new Error("Asset not found");const next={...structuredClone(prev),...patch,id:uid("asset"),version:prev.version+1,parents:[...(patch.parents??[prev.id])],updatedAt:now()};this.assets.set(next.id,next);return next;}
 get(id){return this.assets.get(id)??null;}
 lineage(id){const out=[];const seen=new Set();const walk=x=>{if(!x||seen.has(x))return;seen.add(x);const a=this.get(x);if(!a)return;out.push(a);for(const p of a.parents??[])walk(p)};walk(id);return out;}
}
