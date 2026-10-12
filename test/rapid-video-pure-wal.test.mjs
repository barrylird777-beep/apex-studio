import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { createSovereignAppFabric } from "../src/core/sovereign-app-fabric.mjs";
import { createRapidVideoPureWalQueue } from "../src/workers/rapid-video-pure-wal.mjs";

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test("paid checkout and fulfillment remain durable without PostgreSQL and dedupe webhook retries",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"rapid-pure-wal-"));
  try{
    const store=new ApexPureStore({root});
    const fabric=createSovereignAppFabric({store});
    let orderRuns=0;
    const queue=createRapidVideoPureWalQueue({
      store,fabric,storageDir:root,
      runOrder:async payload=>{orderRuns++;return {url:"/files/rapid_order_"+payload.orderId+"_f"+payload.attemptSuffix.slice(1)+".mp4",artifactName:"rapid_order_"+payload.orderId+"_f"+payload.attemptSuffix.slice(1)+".mp4",format:"mp4",durationSeconds:30,bytes:1024,generatedAt:"2026-10-11T00:00:00.000Z"};},
      runPreview:async payload=>({url:"/files/previews/"+payload.orderId+".mp4",artifactName:payload.orderId+".mp4",format:"mp4",durationSeconds:10,bytes:512,generatedAt:"2026-10-11T00:00:00.000Z"})
    });
    await queue.createCheckoutRecord({orderId:"paid-order-1",name:"Test buyer",email:"buyer@example.com",type:"Short-form",brief:"A dramatic original story",platform:"YouTube Shorts"});
    await queue.updateCheckoutRecord("paid-order-1",{status:"payment_required",stripeSessionId:"cs_test_1",checkoutUrl:"https://checkout.example/cs_test_1"});
    const payment={orderId:"paid-order-1",stripeSessionId:"cs_test_1",stripeEventId:"evt_test_1",paid:true,amount:2500,currency:"USD",paidAt:"2026-10-11T00:00:00.000Z"};
    const queued=await queue.enqueuePaidOrder(payment);
    assert.equal(queued.queued,true);
    assert.equal((await queue.getOrder("paid-order-1")).status,"queued");
    const processed=await queue.processOne({workerId:"test-rapid-worker",leaseMs:10000});
    assert.equal(processed.status,"completed");
    const final=await queue.getOrder("paid-order-1");
    assert.equal(final.status,"completed");
    assert.equal(final.result.url,"/files/rapid_order_paid-order-1_f1.mp4");
    assert.equal(orderRuns,1);
    const duplicate=await queue.enqueuePaidOrder({...payment,stripeEventId:"evt_retry_2"});
    assert.equal(duplicate.duplicate,true);
    assert.equal(orderRuns,1);
    const sale=await fabric.get("kash-kobs","paid-order-paid-order-1");
    assert.equal(sale.record.amount,25);
    assert.equal(sale.record.classification,"observed");
  }finally{await rm(root,{recursive:true,force:true});}
});

test("legacy Stripe events without a matching checkout record require reconciliation, not auto-fulfillment",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"rapid-legacy-reconcile-"));
  try{
    const store=new ApexPureStore({root});
    const fabric=createSovereignAppFabric({store});
    let runs=0;
    const queue=createRapidVideoPureWalQueue({store,fabric,storageDir:root,runOrder:async()=>{runs++;return {url:"/files/should-not-exist.mp4"};}});
    const result=await queue.enqueuePaidOrder({orderId:"legacy-paid-1",stripeSessionId:"cs_legacy",stripeEventId:"evt_legacy",name:"Legacy buyer",paid:true,amount:2500,currency:"USD"});
    assert.equal(result.needsReconciliation,true);
    assert.equal(runs,0);
    assert.equal((await queue.getOrder("legacy-paid-1")).status,"manual-reconciliation-required");
    assert.equal(store.jobs().length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

test("rapid worker lease recovery cannot reclaim a sovereign-runtime job",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"rapid-role-fence-"));
  try{
    const store=new ApexPureStore({root});
    await store.init();
    const job=await store.enqueue({id:"runtime-job-1",type:"sovereign.app.dispatch",payload:{waveId:"wave-1",appId:"kernel-vision",_apex_worker:{role:"sovereign-runtime"}},maxAttempts:3});
    const claimed=(await store.claim({workerId:"runtime-test",limit:1,leaseMs:1000,role:"sovereign-runtime"}))[0];
    assert.equal(claimed.id,job.id);
    await pause(1100);
    await store.recoverExpired(100,"kernelvision-rapid-worker");
    assert.equal(store.jobs().find(item=>item.id===job.id).status,"running");
  }finally{await rm(root,{recursive:true,force:true});}
});
