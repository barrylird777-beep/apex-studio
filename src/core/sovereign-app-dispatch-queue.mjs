/**
 * Drains app dispatches written by the phone/API process. The runtime daemon
 * is the sole writer of the mesh WAL, preventing two processes from racing its
 * sequence/hash chain.
 */
export async function drainSovereignAppDispatchQueue({
  store,engine,peerId,workerId="sovereign-runtime",limit=32,leaseMs=45000
}={}){
  if(!store||typeof store.claim!=="function"||typeof store.transition!=="function")throw new TypeError("durable store is required");
  if(!engine||typeof engine.dispatchAutonomousPayload!=="function")throw new TypeError("sovereign mesh engine is required");
  if(!peerId)throw new Error("runtime peer identity is required");
  await store.init?.();
  const claimed=await store.claim({workerId,limit,leaseMs,role:"sovereign-runtime"});
  const results=[];
  for(const job of claimed){
    if(job.type!=="sovereign.app.dispatch"){
      await store.transition(job.id,"defer",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,delayMs:1000,reason:"Unexpected job type in sovereign runtime queue"});
      continue;
    }
    try{
      const payload=job.payload||{};
      if(!payload.waveId||!payload.appId)throw new Error("App dispatch is missing appId or waveId");
      const record=await engine.dispatchAutonomousPayload({
        waveId:String(payload.waveId),
        peerId:String(peerId),
        action:String(payload.action||"app.publish"),
        payload:{appId:String(payload.appId),data:payload.data??{},source:"phone-control-plane",dispatchJobId:String(job.id)}
      });
      const completed=await store.transition(job.id,"complete",{
        leaseToken:job.leaseToken,leaseFence:job.leaseFence,
        result:{waveId:record.waveId,seq:record.seq,checksum:record.checksum}
      });
      results.push({jobId:job.id,waveId:record.waveId,status:completed?"dispatched":"lease_lost",seq:record.seq,checksum:record.checksum});
    }catch(error){
      const transitioned=await store.transition(job.id,"fail",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,error});
      results.push({jobId:job.id,status:transitioned?"failed_or_requeued":"lease_lost",error:String(error?.message||error)});
    }
  }
  return {claimed:claimed.length,dispatched:results.filter(x=>x.status==="dispatched").length,failed:results.filter(x=>x.status==="failed_or_requeued").length,results};
}
