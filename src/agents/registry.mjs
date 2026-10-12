import { uid, now } from "../core/id.mjs";
export class AgentRegistry {
 constructor(){this.agents=new Map();}
 register(input){const a={id:input.id??uid("agent"),name:input.name??"Agent",role:input.role??"generalist",capabilities:input.capabilities??[],status:"online",createdAt:now(),run:input.run};this.agents.set(a.id,a);return a;}
 list(){return [...this.agents.values()].map(({run,...a})=>a);}
 get(id){return this.agents.get(id)??null;}
}
