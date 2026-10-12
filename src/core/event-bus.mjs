export class EventBus {
  constructor(){this.listeners=new Map();}
  on(type,handler){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(handler);return()=>this.listeners.get(type)?.delete(handler);}
  emit(type,payload={}){for(const handler of this.listeners.get(type)??[]) Promise.resolve(handler(payload)).catch(()=>{});}
}
