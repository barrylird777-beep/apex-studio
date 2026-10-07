import { EventEmitter } from 'node:events';

const DEFAULT_TIMEOUT_MS = 30_000;

export const KORNKNOB_DOMAINS = Object.freeze([
  'music','songs','sound_effects','audio_analysis','audio_generation',
  'audio_discovery','provider_capabilities','audio_provenance'
]);

function required(value,name){if(value===undefined||value===null||value==='')throw new TypeError(name+' is required');}
function validateProviderName(name){const value=String(name).trim();if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value))throw new TypeError('KORNKNOB provider name is invalid');return value;}

export function createKornKnob({providers={},timeoutMs=DEFAULT_TIMEOUT_MS}={}) {
  const events=new EventEmitter();
  const registry=new Map(Object.entries(providers));
  const stats={requests:0,successes:0,failures:0};
  async function run(provider,input={}) {
    const providerName=validateProviderName(provider);
    const fn=registry.get(providerName);
    if(typeof fn!=='function') throw new Error('KORNKNOB provider unavailable: '+providerName);
    stats.requests++;
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),Math.max(1,Number(timeoutMs)||DEFAULT_TIMEOUT_MS));
    try {
      const result=await fn({...input,signal:controller.signal});
      stats.successes++;
      events.emit('result',{provider:providerName,result});
      return result;
    } catch(error) {
      stats.failures++;
      events.emit('error',{provider:providerName,error});
      throw error;
    } finally { clearTimeout(timer); }
  }
  return {
    register(name,handler){const providerName=validateProviderName(name);if(typeof handler!=='function')throw new TypeError('provider handler must be a function');registry.set(providerName,handler);},
    unregister(name){registry.delete(validateProviderName(name));},
    providers(){return [...registry.keys()];},
    run,
    on(...args){events.on(...args);return this;},
    off(...args){events.off(...args);return this;},
    status(){return {domains:[...KORNKNOB_DOMAINS],providers:[...registry.keys()],stats:{...stats}}}
  };
}
