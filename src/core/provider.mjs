export class ProviderRegistry {
 constructor(){this.providers=new Map();}
 register(name,adapter){this.providers.set(name,{name,adapter,createdAt:new Date().toISOString()});return this;}
 names(){return [...this.providers.keys()];}
 async generate(name,input,options={}){const p=this.providers.get(name);if(!p)throw new Error("Provider not registered: "+name);if(typeof p.adapter.generate!=="function")throw new Error("Provider lacks generate()");return p.adapter.generate(input,options);}
}
