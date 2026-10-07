import { EventEmitter } from 'node:events';

const DEFAULT_TIMEOUT_MS = 30_000;

export const KORNKNOB_DOMAINS = Object.freeze([
  'music','songs','sound_effects','audio_analysis','audio_generation',
  'audio_discovery','provider_capabilities','audio_provenance'
]);

function required(value,name){if(value===undefined||value===null||value==='')throw new TypeError(name+' is required');}

export function createKornKnob({providers={},timeoutMs=DEFAULT_TIMEOUT_MS}={}) {
  const events=new EventEmitter();
  const registry=new Map(Object.entries(providers));
  const stats={requests:0,successes:0,failures:0};
  async function run(provider,input={}) {
    required(provider,'provider');
    const fn=registry.get(provider);
    if(typeof fn!=='function') throw new Error('KORNKNOB provider unavailable: '+provider);
    stats.requests++;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.max(1,Number(timeoutMs)||DEFAULT_TIMEOUT_MS));
    try {
      const result=await fn({...input,signal:controller.signal});
      stats.successes++;
      events.emit('result',{provider,result});
      return result;
    } catch(error) {
      stats.failures++;
      events.emit('error',{provider,error});
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    register(name,handler){required(name,'provider name');if(typeof handler!=='function')throw new TypeError('provider handler must be a function');registry.set(name,handler);},
    unregister(name){registry.delete(name);},
    providers(){return [...registry.keys()];},
    run,
    on(...args){events.on(...args);return this;},
    off(...args){events.off(...args);return this;},
    status(){return {domains:[...KORNKNOB_DOMAINS],providers:[...registry.keys()],stats:{...stats}}}
  };
}
