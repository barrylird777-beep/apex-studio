import { uid, now } from "./id.mjs";
export class StrategyEngine {
 constructor(){this.strategies=new Map();}
 create(input={}){const s={id:uid("strategy"),name:input.name??"Untitled Strategy",domain:input.domain??"general",objective:input.objective??"",constraints:input.constraints??[],assumptions:input.assumptions??[],steps:input.steps??[],status:"draft",createdAt:now(),updatedAt:now()};this.strategies.set(s.id,s);return s;}
 get(id){return this.strategies.get(id)??null;}
 list(){return [...this.strategies.values()];}
 evaluate(id,evidence=[]){const s=this.get(id);if(!s)throw new Error("Strategy not found");const conflicts=evidence.filter(x=>x.conflict===true);const support=evidence.filter(x=>x.support===true);return {strategyId:id,supportingEvidence:support.length,conflictingEvidence:conflicts.length,assumptions:s.assumptions,uncertainty:conflicts.length?"elevated":"present",evaluatedAt:now()};}
}