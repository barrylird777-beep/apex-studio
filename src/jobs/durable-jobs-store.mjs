import { apexPureStore } from "../core/apex-pure-store.mjs";

export function createDurableJobsStore(){
  return {
    enqueue: async ({id,type,payload,runAt=new Date(),maxAttempts=8,dedupeKey=null,priority=0,parentJobId=null}) =>
      apexPureStore.enqueue({id:id||undefined,type,payload,runAt:runAt instanceof Date?runAt.getTime():Number(runAt),maxAttempts,dedupeKey,priority,parentJobId}),
    claimBatch: async ({workerId,leaseMs=45000,batchSize=20,role=null}) =>
      apexPureStore.claim({workerId,leaseMs,limit:batchSize,role}),
    claimOne: async ({workerId,leaseMs=45000}) =>
      (await apexPureStore.claim({workerId,leaseMs,limit:1}))[0]||null,
    heartbeat: ({id,token,fence,leaseMs=45000}) =>
      apexPureStore.transition(id,"heartbeat",{leaseToken:token,leaseFence:fence,leaseMs}),
    complete: ({id,token,fence,result}) =>
      apexPureStore.transition(id,"complete",{leaseToken:token,leaseFence:fence,result}),
    fail: ({id,token,fence,error}) =>
      apexPureStore.transition(id,"fail",{leaseToken:token,leaseFence:fence,error}),
    recoverExpired: async options => {
      const limit=typeof options==="number" ? options : Number(options?.limit||500);
      return apexPureStore.recoverExpired(limit);
    },
    close: async()=>{}
  };
}
export default createDurableJobsStore;
