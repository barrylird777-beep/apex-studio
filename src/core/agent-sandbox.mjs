export class AgentSandbox {
 constructor({tools=new Map(),allowlist=[]}={}){this.tools=tools;this.allowlist=new Set(allowlist);}
 async call(name,args={}){if(!this.allowlist.has(name))throw new Error("Tool denied by agent sandbox: "+name);const tool=this.tools.get(name);if(!tool)throw new Error("Tool unavailable: "+name);return tool(args);}
}