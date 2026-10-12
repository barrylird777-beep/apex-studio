import { uid, now } from "./id.mjs";
export class DecisionEngine {
 constructor(){this.decisions=[];}
 analyze(input={}){const d={id:uid("decision"),question:input.question??"",options:input.options??[],criteria:input.criteria??[],evidence:input.evidence??[],risks:input.risks??[],unknowns:input.unknowns??[],createdAt:now()};this.decisions.push(d);return d;}
 list(){return [...this.decisions];}
}