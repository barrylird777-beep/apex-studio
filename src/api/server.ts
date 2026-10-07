import http from "node:http";import {createReadStream,existsSync} from "node:fs";import {extname,join} from "node:path";import {fileURLToPath} from "node:url";import {spawn} from "node:child_process";import {createProject,deleteProject,getProjectOverview,listProjects,updateProject} from "./projects";import {createCharacter,deleteCharacter,getCharacter,listCharacters,updateCharacter} from "./characters";import {listScenes,createScene,updateScene,deleteScene} from "./scenes";// @ts-ignore JavaScript pipeline modules are runtime-tested by Node.
import {generateBreakdown,BreakdownError} from "../scripture/breakdown.js";
import {getCalendar,createShootDay,deleteShootDay,assignScenes,reorderDay,unassignScene,runAutoSchedule} from "./schedule";
// @ts-ignore JavaScript provider adapter is runtime-loaded.
import {generateWithGemini} from "../ai/gemini.js";// @ts-ignore
import {selectNetworkPath} from "../network/path-selector.mjs";
// @ts-ignore
import {swarmPeers} from "../network/ipfs-swarm.mjs";
// @ts-ignore
import {describeNetworkSettings} from "../core/network-status.mjs";
// @ts-ignore Runtime-tested JavaScript ad-block modules are loaded by Node at runtime.
import {initializeStudioAdBlock,handleStudioAdBlockDoH,studioAdBlockStatus} from "../network/studio-adblock-doh.mjs";
// @ts-ignore Runtime-tested JavaScript ad-block profile module is loaded by Node at runtime.
import {studioAdBlockMobileConfig} from "../network/studio-adblock-profile.mjs";
// @ts-ignore Runtime-tested JavaScript copilot module.
import {createEvalCopilotHandler} from "./ai-eval-copilot.mjs";
// @ts-ignore Sovereign capability fabric is runtime-tested JavaScript.
import {handleApexCapabilityApi} from "./apex-capability-api.mjs";
const root=fileURLToPath(new URL("../../",import.meta.url));const port=Number(process.env.PORT||3001);const dev=process.argv.includes("--dev");let vite:any;
const send=(res:http.ServerResponse,status:number,data:unknown)=>{res.writeHead(status,{"content-type":"application/json"});res.end(status===204?"":JSON.stringify(data))};
const readBody=(req:http.IncomingMessage)=>new Promise<any>((resolve,reject)=>{let s="";let size=0;req.on("data",c=>{size+=c.length;if(size>256000){reject(Error("Request body too large"));req.destroy();return;}s+=c});req.on("end",()=>{try{resolve(s?JSON.parse(s):{})}catch{reject(Error("Invalid JSON"))}});req.on("error",reject)});
const evalCopilot=createEvalCopilotHandler();
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url||"/","http://localhost"),p=u.pathname.split("/").filter(Boolean);
if(u.pathname.startsWith("/api/apex/capabilities")){const capabilityBody=req.method==="POST"?await readBody(req):{};if((await handleApexCapabilityApi({method:req.method||"GET",path:u.pathname,body:capabilityBody,send}))!==false)return;}
if(p[0]==="api"&&p[1]==="characters"){if(p.length===2&&req.method==="GET")return send(res,200,await listCharacters(u.searchParams.get("q")||""));if(p.length===2&&req.method==="POST")return send(res,201,await createCharacter(await readBody(req)));const id=Number(p[2]);if(!Number.isInteger(id))return send(res,400,{error:"Invalid character id"});if(p.length===3&&req.method==="GET"){const c=await getCharacter(id);return c?send(res,200,c):send(res,404,{error:"Character not found"})}if(p.length===3&&req.method==="PUT"){const c=await updateCharacter(id,await readBody(req));return c?send(res,200,c):send(res,404,{error:"Character not found"})}if(p.length===3&&req.method==="DELETE"){return await deleteCharacter(id)?send(res,204,null):send(res,404,{error:"Character not found"})}}
if(p[0]==="api"&&p[1]==="projects"){if(p.length===2&&req.method==="GET")return send(res,200,await listProjects());if(p.length===2&&req.method==="POST")return send(res,201,await createProject(await readBody(req)));const id=Number(p[2]);if(!Number.isInteger(id))return send(res,400,{error:"Invalid project id"});if(p[3]==="overview"&&req.method==="GET"){const o=await getProjectOverview(id);return o?send(res,200,o):send(res,404,{error:"Project not found"})}if(p.length===3&&req.method==="PUT"){const o=await updateProject(id,await readBody(req));return o?send(res,200,o):send(res,404,{error:"Project not found"})}if(p.length===3&&req.method==="DELETE"){await deleteProject(id);return send(res,204,null)}if(p[3]==="scenes"&&req.method==="GET")return send(res,200,await listScenes(id));if(p[3]==="scenes"&&req.method==="POST"){const s=await createScene({...await readBody(req),projectId:id});return s?send(res,201,s):send(res,404,{error:"Project not found"})}}
if(p[0]==="api"&&p[1]==="projects"&&p[3]==="calendar"&&req.method==="GET"){
  const id=Number(p[2]); if(!Number.isInteger(id)) return send(res,400,{error:"Invalid project id"});
  return send(res,200,await getCalendar(id));
}
if(p[0]==="api"&&p[1]==="projects"&&p[3]==="shoot-days"&&req.method==="POST"){
  const id=Number(p[2]); if(!Number.isInteger(id)) return send(res,400,{error:"Invalid project id"});
  const body=await readBody(req); const validShootDate=(value:unknown)=>{if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const [y,m,d]=value.split("-").map(Number); const dt=new Date(Date.UTC(y,m-1,d)); return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;}; if(!validShootDate(body.shootDate)) return send(res,400,{error:"shootDate must be a valid YYYY-MM-DD date"});
  try { const day=await createShootDay({projectId:id,shootDate:body.shootDate,callTime:body.callTime||null,notes:String(body.notes||"")}); return day?send(res,201,day):send(res,404,{error:"Project not found"}); }
  catch(e){ if((e as any)?.code==="DUPLICATE_DATE") return send(res,409,{error:(e as any).message}); throw e; }
}
if(p[0]==="api"&&p[1]==="projects"&&p[3]==="auto-schedule"&&req.method==="POST"){
  const id=Number(p[2]); if(!Number.isInteger(id)) return send(res,400,{error:"Invalid project id"});
  const body=await readBody(req); return send(res,200,await runAutoSchedule(id,{maxScenes:Number.isInteger(body.maxScenes)?body.maxScenes:undefined}));
}
if(p[0]==="api"&&p[1]==="shoot-days"&&p[2]){
  const id=Number(p[2]); if(!Number.isInteger(id)) return send(res,400,{error:"Invalid shoot day id"});
  if(p.length===3&&req.method==="DELETE") return await deleteShootDay(id)?send(res,204,null):send(res,404,{error:"Shoot day not found"});
  if(p.length===4&&p[3]==="scenes"&&req.method==="POST"){ const body=await readBody(req); if(!Array.isArray(body.sceneIds)) return send(res,400,{error:"sceneIds must be an array"}); try{return send(res,200,await assignScenes(id,body.sceneIds))}catch(e){const code=(e as any)?.code;return send(res,code==="NOT_FOUND"?404:code==="PROJECT_SCOPE"?400:400,{error:(e as any)?.message||"Unable to assign scenes"})} }
  if(p.length===4&&p[3]==="order"&&req.method==="PUT"){ const body=await readBody(req); if(!Array.isArray(body.sceneIds)) return send(res,400,{error:"sceneIds must be an array"}); try{return send(res,200,await reorderDay(id,body.sceneIds))}catch(e){const code=(e as any)?.code;return send(res,code==="NOT_FOUND"?404:400,{error:(e as any)?.message||"Unable to reorder scenes"})} }
}
if(p[0]==="api"&&p[1]==="scenes"&&p[2]&&p[3]==="assignment"&&req.method==="DELETE"){
  const id=Number(p[2]); if(!Number.isInteger(id)) return send(res,400,{error:"Invalid scene id"});
  return await unassignScene(id)?send(res,204,null):send(res,404,{error:"Scene is not assigned"});
}
if(p[0]==="api"&&p[1]==="scenes"&&p[2]){const id=Number(p[2]);if(!Number.isInteger(id))return send(res,400,{error:"Invalid scene id"});if(p.length===3&&req.method==="PUT"){const s=await updateScene(id,await readBody(req));return s?send(res,200,s):send(res,404,{error:"Scene not found"})}if(p.length===3&&req.method==="DELETE")return await deleteScene(id)?send(res,204,null):send(res,404,{error:"Scene not found"})}
if(p[0]==="api"&&p[1]==="scripture"&&p[2]==="breakdown"&&req.method==="POST"){const body=await readBody(req),reference=typeof body.reference==="string"?body.reference.trim():"",text=body.text;if(!reference)return send(res,400,{error:"reference is required"});if(text!==undefined&&(typeof text!=="string"||text.length>20000))return send(res,400,{error:"text must be a string up to 20000 characters"});try{const result=await generateBreakdown({reference,text,generate:generateWithGemini,refine:body.refine?{provider:"claude",model:"claude-sonnet-5-5"}:null});return send(res,200,result)}catch(e){const err=e as any;if(err?.name==="BreakdownError")return send(res,502,{error:err.message,stage:err.stage,details:err.errors});console.error("scripture breakdown failed",e);return send(res,500,{error:e instanceof Error?e.message:"breakdown failed"})}}
if((await evalCopilot(req,res,u.pathname,readBody,send))!==false)return;
if(p[0]==="api"&&p[1]==="network"&&p[2]==="adblock"&&p[3]==="profile"&&req.method==="GET"){
  try { const body=studioAdBlockMobileConfig(); res.writeHead(200,{"content-type":"application/x-apple-aspen-config","content-disposition":"attachment; filename=\"Apex-Studio-Ad-Blocker.mobileconfig\"","cache-control":"no-store"}); res.end(body); } catch(e) { return send(res,500,{error:e instanceof Error?e.message:"profile generation failed"}); }
  return;
}
if(p[0]==="api"&&p[1]==="network"&&p[2]==="adblock"&&p[3]==="status"&&req.method==="GET"){
  return send(res,200,studioAdBlockStatus());
}
if(p[0]==="api"&&p[1]==="network"&&p[2]==="adblock"&&p[3]==="doh"){
  return handleStudioAdBlockDoH(req,res,u);
}
if(p[0]==="api"&&p[1]==="network"&&p[2]==="status"&&req.method==="GET"){
  try {
    const timeout=new Promise((_,reject)=>setTimeout(()=>reject(new Error("network telemetry timeout")),5000));
    const telemetry=await Promise.race([selectNetworkPath(),timeout]);
    const peers=await swarmPeers();
    const selected=telemetry?.selected||null;
    const state=selected?.healthy?"connected":(telemetry?.candidates?.length?"degraded":"offline");
    return send(res,200,{state,verified:false,checkedAt:new Date().toISOString(),selected,failover:telemetry?.failover||[],candidates:telemetry?.candidates||[],peers:typeof peers==="object"?peers:peers.length,settings:describeNetworkSettings({speed:"maximum"})});
  } catch(e) {
    return send(res,200,{state:"offline",verified:false,checkedAt:new Date().toISOString(),selected:null,failover:[],candidates:[],peers:{available:false},settings:describeNetworkSettings({speed:"maximum"}),error:e instanceof Error?e.message:"network telemetry unavailable"});
  }
}
if(!dev){const path=u.pathname==="/"?"index.html":u.pathname.slice(1),f=join(root,"dist",path),file=existsSync(f)?f:join(root,"dist","index.html");res.writeHead(200,{"content-type":({".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"} as any)[extname(file)]||"application/octet-stream"});return createReadStream(file).pipe(res)}res.writeHead(404);res.end()}catch(e){send(res,400,{error:e instanceof Error?e.message:"Request failed"})}});
void initializeStudioAdBlock();
server.listen(port,()=>{if(dev)vite=spawn(process.platform==="win32"?"npx.cmd":"npx",["vite","--host","0.0.0.0"],{cwd:root,stdio:"inherit"});else console.log("Apex Studio listening on "+port)});process.on("SIGINT",()=>{vite?.kill();server.close()});process.on("SIGTERM",()=>{vite?.kill();server.close()});
