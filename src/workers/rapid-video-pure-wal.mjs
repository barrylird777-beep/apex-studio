import path from "node:path";
import { unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { apexPureStore } from "../core/apex-pure-store.mjs";
import { sovereignAppFabric } from "../core/sovereign-app-fabric.mjs";
import { executeRapidVideoOrder, executeRapidVideoPreview } from "./rapid-video-worker.mjs";

const ROLE="kernelvision-rapid-worker";
const ORDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,100}$/;
const now=()=>new Date().toISOString();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeId=value=>{
  const id=String(value??"").trim();
  if(!ORDER_ID.test(id)||id.includes(".."))throw Object.assign(new Error("Invalid rapid order id"),{status:400});
  return id;
};
const safeError=error=>String(error?.message||error||"Production failed").slice(0,1000);
const publicResult=result=>result?{
  url:result.url||null,
  format:result.format||null,
  durationSeconds:Number(result.durationSeconds)||null,
  bytes:Number(result.bytes)||null,
  generatedAt:result.generatedAt||null
}:null;

export function createRapidVideoPureWalQueue({
  store=apexPureStore,
  fabric=sovereignAppFabric,
  runOrder=executeRapidVideoOrder,
  runPreview=executeRapidVideoPreview,
  storageDir=process.env.STORAGE_DIR||"/srv/apex/se-x/projects"
}={}){
  let stopRequested=false;
  let lastRecoveryAt=0;

  async function init(){await store.init();return true;}
  const orderKey=id=>"rapid-order-"+safeId(id);
  const previewKey=id=>"rapid-preview-"+safeId(id);

  async function createCheckoutRecord(input={}){
    await init();
    const orderId=safeId(input.orderId||randomUUID());
    const existing=await fabric.get("kash-korner",orderKey(orderId));
    if(existing)throw Object.assign(new Error("Rapid order id already exists"),{status:409});
    const record={
      orderId,queueMode:"pure-wal-v1",kind:"paid-order",status:"creating_checkout",
      name:String(input.name||"").trim().slice(0,120),
      email:String(input.email||"").trim().slice(0,320).toLowerCase(),
      type:String(input.type||"Short-form video").trim().slice(0,160),
      brief:String(input.brief||"").trim().slice(0,4000),
      platform:String(input.platform||"Other").trim().slice(0,80),
      price:25,currency:"USD",createdAt:now(),updatedAt:now()
    };
    await fabric.put("kash-korner",orderKey(orderId),record);
    return record;
  }

  async function updateCheckoutRecord(orderId,patch={}){
    await init();
    const id=safeId(orderId),stored=await fabric.get("kash-korner",orderKey(id));
    if(!stored)throw Object.assign(new Error("Rapid checkout record not found"),{status:404});
    const next={...stored.record,...patch,orderId:id,queueMode:"pure-wal-v1",updatedAt:now()};
    await fabric.put("kash-korner",orderKey(id),next);
    return next;
  }

  async function enqueuePreview(input={}){
    await init();
    const orderId=safeId(input.orderId||randomUUID());
    const record={
      orderId,queueMode:"pure-wal-v1",kind:"preview",status:"queued",
      name:String(input.name||"Preview visitor").trim().slice(0,120),
      type:String(input.type||"Creative proof").trim().slice(0,160),
      brief:String(input.brief||"").trim().slice(0,4000),
      platform:String(input.platform||"Short-form social").trim().slice(0,80),
      createdAt:now(),updatedAt:now()
    };
    const queued=await store.enqueue({
      id:orderId,type:"kernelvision.rapid.preview",
      payload:{...record,_apex_worker:{role:ROLE}},
      maxAttempts:1,dedupeKey:"rapid-preview:"+orderId
    });
    await fabric.put("kash-korner",previewKey(queued.id),{...record,orderId:queued.id,status:queued.status||"queued"});
    return {orderId:queued.id,status:queued.status||"queued",duplicate:Boolean(queued.duplicate)};
  }

  async function enqueuePaidOrder(payment={}){
    await init();
    const orderId=safeId(payment.orderId);
    const stored=await fabric.get("kash-korner",orderKey(orderId));
    const sessionId=String(payment.stripeSessionId||"");
    if(!stored||stored.record.queueMode!=="pure-wal-v1"||!stored.record.stripeSessionId||stored.record.stripeSessionId!==sessionId){
      const reconciliation={
        orderId,queueMode:"pure-wal-v1",kind:"paid-order",status:"manual-reconciliation-required",
        name:String(payment.name||"").slice(0,120),email:String(payment.email||"").slice(0,320),
        type:String(payment.type||"Short-form video").slice(0,160),brief:String(payment.brief||"").slice(0,4000),
        platform:String(payment.platform||"Other").slice(0,80),price:25,currency:"USD",
        stripeSessionId:sessionId||null,stripeEventId:String(payment.stripeEventId||"")||null,
        paymentVerified:true,paidAt:String(payment.paidAt||now()),updatedAt:now(),
        error:"No matching Pure-WAL checkout record; do not auto-fulfil a legacy payment."
      };
      await fabric.put("kash-korner",orderKey(orderId),reconciliation);
      return {queued:false,needsReconciliation:true,orderId};
    }

    if(["queued","processing","completed","failed","manual-reconciliation-required"].includes(stored.record.status)){
      await recordObservedSale(orderId,payment);
      return {queued:["queued","processing"].includes(stored.record.status),duplicate:true,status:stored.record.status,orderId};
    }

    const order={...stored.record,...payment,orderId,price:25,currency:"USD",paid:true,paidAt:String(payment.paidAt||now())};
    const queued=await store.enqueue({
      id:orderId,type:"kernelvision.rapid.order",
      payload:{...order,_apex_worker:{role:ROLE}},
      maxAttempts:3,dedupeKey:"rapid-paid:"+orderId
    });
    await fabric.put("kash-korner",orderKey(orderId),{
      ...order,status:["queued","running","completed","dead"].includes(queued.status)?queued.status:"queued",
      jobId:String(queued.id),stripeEventId:String(payment.stripeEventId||order.stripeEventId||"")||null,
      paymentVerified:true,updatedAt:now()
    });
    await recordObservedSale(orderId,payment);
    return {queued:true,duplicate:Boolean(queued.duplicate),orderId,jobId:String(queued.id),status:queued.status||"queued"};
  }

  async function recordObservedSale(orderId,payment={}){
    await fabric.put("kash-kobs","paid-order-"+safeId(orderId),{
      kind:"observed-paid-order",orderId:safeId(orderId),amount:25,currency:"USD",
      classification:"observed",status:"paid",
      evidence:{source:"verified Stripe webhook",stripeSessionId:String(payment.stripeSessionId||"")||null,stripeEventId:String(payment.stripeEventId||"")||null},
      observedAt:String(payment.paidAt||now()),updatedAt:now()
    });
  }

  async function getOrder(orderId){
    await init();
    const id=safeId(orderId);
    const job=store.jobs().find(item=>String(item.id)===id&&String(item.type||"").startsWith("kernelvision.rapid."));
    const key=job?.type==="kernelvision.rapid.preview"?previewKey(id):orderKey(id);
    const stored=await fabric.get("kash-korner",key);
    if(!stored&&!job)return null;
    const record=stored?.record||{};
    let status=record.status||"queued";
    if(job){
      if(job.status==="completed")status="completed";
      else if(job.status==="dead")status="failed";
      else if(job.status==="running")status="processing";
      else if(job.status==="queued"&&record.status!=="payment_required")status="queued";
    }
    const result=publicResult(job?.result||record.result);
    return {
      success:true,orderId:id,status,kind:record.kind|| (job?.type==="kernelvision.rapid.preview"?"preview":"paid-order"),
      price:record.price||null,currency:record.currency||null,
      attempts:Number(job?.attempts||0),maxAttempts:Number(job?.maxAttempts||0),
      result,error:job?.lastError?String(job.lastError).slice(0,1000):record.status==="failed"?safeError(record.error):null,
      createdAt:record.createdAt||job?.createdAt||null,
      updatedAt:record.updatedAt||job?.updatedAt||null,
      paidAt:record.paidAt||null
    };
  }

  async function processOne({workerId="kernelvision-rapid-"+process.pid,leaseMs=120000}={}){
    await init();
    const claimed=await store.claim({workerId,limit:1,leaseMs,role:ROLE});
    const job=claimed[0];
    if(!job)return {worked:false};
    if(!["kernelvision.rapid.order","kernelvision.rapid.preview"].includes(job.type)){
      await store.transition(job.id,"defer",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,delayMs:5000,reason:"Unsupported KernelVision rapid task type"});
      return {worked:true,status:"deferred",jobId:job.id};
    }
    const isPreview=job.type==="kernelvision.rapid.preview";
    const key=isPreview?previewKey(job.id):orderKey(job.id);
    const record=(await fabric.get("kash-korner",key))?.record||{};
    await fabric.put("kash-korner",key,{...record,status:"processing",attempts:job.attempts,leaseFence:job.leaseFence,updatedAt:now()});

    let heartbeatBusy=false;
    const heartbeat=setInterval(()=>{
      if(heartbeatBusy)return;
      heartbeatBusy=true;
      void store.transition(job.id,"heartbeat",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,leaseMs})
        .catch(()=>{}).finally(()=>{heartbeatBusy=false;});
    },Math.max(5000,Math.floor(leaseMs/3)));
    heartbeat.unref?.();

    let rendered;
    try{
      rendered=isPreview
        ? await runPreview({...job.payload,attemptSuffix:"f"+job.leaseFence})
        : await runOrder({...job.payload,attemptSuffix:"f"+job.leaseFence});
      const result={
        url:String(rendered?.url||""),artifactName:String(rendered?.artifactName||""),
        format:String(rendered?.format||"mp4"),durationSeconds:Number(rendered?.durationSeconds)||null,
        bytes:Number(rendered?.bytes)||null,generatedAt:String(rendered?.generatedAt||now())
      };
      const completed=await store.transition(job.id,"complete",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,result});
      if(!completed){
        if(result.artifactName&&/^[A-Za-z0-9._-]+$/.test(result.artifactName))await unlink(path.join(storageDir,result.artifactName)).catch(()=>{});
        return {worked:true,status:"lease-lost",jobId:job.id};
      }
      await fabric.put("kash-korner",key,{...record,status:"completed",result,completedAt:now(),updatedAt:now(),leaseFence:job.leaseFence});
      return {worked:true,status:"completed",jobId:job.id};
    }catch(error){
      const changed=await store.transition(job.id,"fail",{leaseToken:job.leaseToken,leaseFence:job.leaseFence,error});
      const status=Number(job.attempts)>=Number(job.maxAttempts)?"failed":"retrying";
      await fabric.put("kash-korner",key,{...record,status,error:safeError(error),updatedAt:now(),leaseFence:job.leaseFence}).catch(()=>{});
      return {worked:true,status:changed?status:"lease-lost",jobId:job.id,error:safeError(error)};
    }finally{
      clearInterval(heartbeat);
    }
  }

  async function runForever({pollMs=1500,workerId="kernelvision-rapid-"+process.pid}={}){
    stopRequested=false;
    while(!stopRequested){
      try{
        await init();
        if(Date.now()-lastRecoveryAt>30000){await store.recoverExpired(100);lastRecoveryAt=Date.now();}
        const result=await processOne({workerId});
        if(!result.worked)await sleep(pollMs);
      }catch(error){
        console.error("[kernelvision-rapid-pure-wal]",safeError(error));
        await sleep(5000);
      }
    }
  }
  function stop(){stopRequested=true;}

  return {init,createCheckoutRecord,updateCheckoutRecord,enqueuePreview,enqueuePaidOrder,getOrder,processOne,runForever,stop};
}

export const rapidVideoPureWalQueue=createRapidVideoPureWalQueue();
