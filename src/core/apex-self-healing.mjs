import { appendEvent } from './sovereign-local-storage.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class ApexSelfHealing {
  constructor({ name, run, recover, maxRetries = 3, backoffMs = 250 } = {}) {
    if (!name || typeof run !== 'function') throw new TypeError('self-healing worker requires name and run');
    this.name=name;
    this.run=run;
    this.recover=typeof recover === 'function' ? recover : async () => {};
    this.maxRetries=Math.max(0,Number(maxRetries));
    this.backoffMs=Math.max(10,Number(backoffMs));
  }

  async execute(context = {}) {
    let lastError;
    for (let attempt=0; attempt<=this.maxRetries; attempt++) {
      try {
        const result=await this.run(context,{attempt});
        await appendEvent('selfheal.success',{worker:this.name,attempt},{stream:'selfheal'});
        return result;
      } catch (error) {
        lastError=error;
        await appendEvent('selfheal.failure',{
          worker:this.name,attempt,error:String(error),
          recoverable:attempt<this.maxRetries
        },{stream:'selfheal'});
        if (attempt>=this.maxRetries) break;
        try { await this.recover(error,context,{attempt}); } catch (recoveryError) {
          await appendEvent('selfheal.recovery-failure',{worker:this.name,attempt,error:String(recoveryError)},{stream:'selfheal'});
        }
        await sleep(this.backoffMs * (2 ** attempt));
      }
    }
    throw lastError;
  }
}

export function withSelfHealing(options) {
  const controller=new ApexSelfHealing(options);
  return context => controller.execute(context);
}
