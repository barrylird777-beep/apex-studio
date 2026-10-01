export class Metrics {
 constructor(){this.counters=new Map();this.latencies=new Map();}
 count(name,n=1){this.counters.set(name,(this.counters.get(name)??0)+n);}
 observe(name,ms){const a=this.latencies.get(name)??[];a.push(ms);this.latencies.set(name,a.slice(-1000));}
 snapshot(){return {counters:Object.fromEntries(this.counters),latencies:Object.fromEntries([...this.latencies].map(([k,v])=>[k,{count:v.length,avg:v.reduce((a,b)=>a+b,0)/(v.length||1),max:Math.max(0,...v)}]))};}
}