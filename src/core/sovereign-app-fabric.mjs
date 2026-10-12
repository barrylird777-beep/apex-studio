import { randomUUID } from "node:crypto";
import { APEX_APPS } from "../apps/apex-six-apps.mjs";
import { apexPureStore } from "./apex-pure-store.mjs";

const APP_LIST=Object.values(APEX_APPS).map(({id,name,role,entry})=>({id,name,role,entry}));
const APP_IDS=new Set(APP_LIST.map(app=>app.id));
const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

function assertApp(appId){
  const id=String(appId||"");
  if(!APP_IDS.has(id))throw Object.assign(new Error("Unknown canonical Apex app."),{status:404});
  return id;
}
function assertId(value){
  const id=String(value||"");
  if(!ID.test(id)||id.includes(".."))throw Object.assign(new Error("Invalid record id."),{status:400});
  return id;
}
function liveRuntime(record){
  if(record?.status!=="online"||!record.peerId)return false;
  const expiry=Number(record.leaseExpiresAt);
  return Number.isFinite(expiry)&&expiry>Date.now();
}

/**
 * Durable shared namespaces for all six apps. Dispatch is queued locally here;
 * only the sovereign runtime daemon may turn it into a mesh event and report
 * actual peer transport. The phone API never fabricates a network ACK.
 */
export function createSovereignAppFabric({store=apexPureStore}={}){
  let readyPromise=null;
  async function init(){
    if(!readyPromise)readyPromise=store.init().catch(error=>{readyPromise=null;throw error;});
    await readyPromise;
    return true;
  }
  async function status(){
    await init();
    const [runtime]=await Promise.all([store.get("sovereign_runtime","identity")]);
    const jobs=store.jobs();
    const pendingDispatches=jobs.filter(job=>job.type==="sovereign.app.dispatch"&&["queued","running"].includes(job.status)).length;
    const online=liveRuntime(runtime);
    return {
      ok:true,
      storage:"local-pure-wal",
      durableStoreReady:true,
      canonicalAppCount:APP_LIST.length,
      apps:APP_LIST.map(app=>({...app,storageNamespace:`app-${app.id}`})),
      mesh:{runtimeOnline:online,peerIdentityConfigured:online,peerId:online?runtime.peerId:null,transportOwner:"sovereign-runtime-daemon",dispatchMode:"durable-queue",pendingDispatches},
      checkedAt:new Date().toISOString()
    };
  }
  async function put(appId,recordId,record){
    await init();
    const app=assertApp(appId),id=assertId(recordId);
    if(!record||typeof record!=="object"||Array.isArray(record))throw Object.assign(new Error("Record must be a JSON object."),{status:400});
    const saved=await store.put(`app-${app}`,id,{...clone(record),appId:app,id});
    return {appId:app,id,record:saved,durable:true,storage:"local-pure-wal"};
  }
  async function get(appId,recordId){
    await init();
    const app=assertApp(appId),id=assertId(recordId);
    const record=await store.get(`app-${app}`,id);
    return record?{appId:app,id,record,durable:true,storage:"local-pure-wal"}:null;
  }
  async function list(appId){
    await init();
    const app=assertApp(appId);
    return (await store.list(`app-${app}`)).map(record=>({appId:app,id:record.id,record,durable:true,storage:"local-pure-wal"}));
  }
  async function dispatch(payload){
    await init();
    if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Object.assign(new Error("Dispatch payload must be an object."),{status:400});
    const app=assertApp(payload.appId);
    const waveId=assertId(payload.waveId||randomUUID());
    const dedupeKey=`sovereign-app-dispatch:${waveId}`;
    const existing=store.jobs().find(job=>job.dedupeKey===dedupeKey);
    if(existing){
      return {accepted:true,durable:true,queued:["queued","running"].includes(existing.status),duplicate:true,peerPending:existing.status!=="completed",appId:app,waveId,jobId:String(existing.id),status:existing.status};
    }
    const result=await store.enqueue({
      id:randomUUID(),
      type:"sovereign.app.dispatch",
      payload:{appId:app,waveId,action:String(payload.action||"app.publish").slice(0,160),data:clone(payload.data??{}),requestedAt:new Date().toISOString(),_apex_worker:{role:"sovereign-runtime"}},
      dedupeKey
    });
    return {accepted:true,durable:true,queued:true,duplicate:Boolean(result.duplicate),peerPending:true,appId:app,waveId,jobId:String(result.id),status:"queued"};
  }
  return {init,status,put,get,list,dispatch,apps:()=>APP_LIST.map(clone)};
}
export const sovereignAppFabric=createSovereignAppFabric();
