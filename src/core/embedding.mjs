export class EmbeddingIndex {
 constructor(adapter=null){this.adapter=adapter;this.items=[];}
 async add(id,text,metadata={}){this.items.push({id,text,metadata,vector:this.adapter?await this.adapter.embed(text):null});return this.items.at(-1);}
 async search(text,limit=10){if(!this.adapter) return this.items.filter(x=>x.text.toLowerCase().includes(String(text).toLowerCase())).slice(0,limit);const v=await this.adapter.embed(text);const score=(a,b)=>a.reduce((s,x,i)=>s+x*(b[i]??0),0)/(Math.hypot(...a)*Math.hypot(...b)||1);return this.items.map(x=>({...x,score:score(v,x.vector??[])})).sort((a,b)=>b.score-a.score).slice(0,limit);}
}
