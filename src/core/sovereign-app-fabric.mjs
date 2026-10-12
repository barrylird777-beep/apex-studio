import { APEX_APPS } from "../apps/apex-six-apps.mjs";
import { apexPureStore } from "./apex-pure-store.mjs";
import SovereignMeshEngine from "./sovereign-mesh-engine.mjs";
import { createSovereignDurableBridge } from "./sovereign-durable-bridge.mjs";

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

/**
 * One local durable fabric shared by the six canonical apps and authenticated
 * phone control plane. This is an integration layer; it does not silently
 * rewrite the apps' existing domain models or claim a peer is online.
 */
export function createSovereignAppFabric({store=apexPureStore,engineFactory=()=>new SovereignMeshEngine()}={}){
  let engine=null;
  let bridge=null;
  let readyPromise=null;
  async function init(){
    if(!readyPromise){
      readyPromise=(async()=>{
        await store.init();
        engine=engine||engineFactory();
        await engine.ready();
        bridge=createSovereignDurableBridge({engine,store,workerId:process.env.APEX_SOVEREIGN_WORKER_ID||`app-fabric-${process.pid}`});
        return true;
      })().catch(error=>{readyPromise=null;throw error;});
    }
    await readyPromise;
    return true;
  }
  async function status(){
    await init();
    const snapshot=engine.snapshot();
    return {
      ok:true,
      storage:"local-pure-wal",
      durableStoreReady:true,
      canonicalAppCount:APP_LIST.length,
      apps:APP_LIST.map(app=>({...app,storageNamespace:`app-${app.id}`})),
      mesh:{ready:true,peerIdentityConfigured:Boolean(process.env.APEX_SOVEREIGN_PEER_ID),dispatchRequiresPeerIdentity:true,transportOwner:"sovereign-runtime-daemon",recordCount:snapshot.length},
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
    if(!process.env.APEX_SOVEREIGN_PEER_ID)throw Object.assign(new Error("Sovereign peer identity is not configured; dispatch is fail-closed."),{status:503});
    if(!payload||typeof payload!=="object"||Array.isArray(payload))throw Object.assign(new Error("Dispatch payload must be an object."),{status:400});
    const app=assertApp(payload.appId);
    const record=await engine.dispatchAutonomousPayload({
      waveId:payload.waveId,
      action:payload.action||"app.publish",
      payload:{appId:app,data:clone(payload.data??{})}
    });
    // Persist the event as a durable job but leave it DISPATCHED until the
    // sovereign runtime daemon confirms peer transport. Do not fake an ACK.
    const job=await bridge.persist(record);
    return {accepted:true,durable:true,queued:true,peerPending:true,appId:app,waveId:record.waveId,seq:record.seq,checksum:record.checksum,jobId:job.id,status:record.status};
  }
  return {init,status,put,get,list,dispatch,apps:()=>APP_LIST.map(clone)};
}

export const sovereignAppFabric=createSovereignAppFabric();
