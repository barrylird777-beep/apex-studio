export class ToolRegistry {
 constructor(){this.tools=new Map();}
 register(name,fn,meta={}){this.tools.set(name,{name,fn,meta});return this;}
 describe(){return [...this.tools.values()].map(({fn,...x})=>x);}
 async call(name,args={}){const t=this.tools.get(name);if(!t)throw new Error("Tool not found: "+name);return t.fn(args);}
}
