import { uid, now } from "./id.mjs";
export class ResearchEngine {
 constructor(){this.projects=new Map();}
 create(input={}){const r={id:uid("research"),question:input.question??"",sources:input.sources??[],claims:input.claims??[],queries:input.queries??[],status:"open",createdAt:now()};this.projects.set(r.id,r);return r;}
 addClaim(id,claim){const r=this.projects.get(id);if(!r)throw new Error("Research project not found");r.claims.push({...claim,addedAt:now()});return r;}
 get(id){return this.projects.get(id)??null;}
 list(){return [...this.projects.values()];}
}