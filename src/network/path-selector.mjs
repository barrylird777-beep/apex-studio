import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const STARLINK_HINT = process.env.APEX_STARLINK_INTERFACE || 'starlink';
const APPLY_ROUTES = process.env.APEX_NETWORK_APPLY_ROUTES === 'true';
async function interfaces(){const {stdout}=await exec('ip',['-o','link','show']);return stdout.trim().split('\n').filter(Boolean).map(line=>line.split(': ')[1]?.split('@')[0]).filter(x=>x&&x!=='lo');}
async function probe(dev){const started=performance.now();try{const {stdout}=await exec('curl',['-4','-L','--silent','--show-error','--fail','--interface',dev,'--connect-timeout','2','--max-time',process.env.APEX_PATH_PROBE_TIMEOUT||'5','-o','/dev/null','-w','%{http_code}',process.env.APEX_PATH_PROBE_URL||'https://www.starlink.com/']);return{healthy:true,rttMs:performance.now()-started,httpCode:Number(stdout)||0};}catch{return{healthy:false,rttMs:Infinity,httpCode:0};}}
function score(dev,result){if(!result.healthy)return 0;const preferred=dev.toLowerCase().includes(STARLINK_HINT.toLowerCase())?25:0;return Math.max(0,100-Math.min(100,result.rttMs*2))+preferred;}
async function applyPriority(dev){if(!APPLY_ROUTES)return{applied:false,reason:'route mutation disabled'};try{await exec('ip',['route','replace','default','dev',dev,'metric','50']);return{applied:true,device:dev};}catch(error){return{applied:false,device:dev,error:error.message};}}
export async function selectNetworkPath(){const candidates=[];for(const dev of await interfaces()){const result=await probe(dev);candidates.push({device:dev,...result,score:score(dev,result)});}candidates.sort((a,b)=>b.score-a.score);const selected=candidates[0]||null;return{selected,candidates,route:selected?await applyPriority(selected.device):{applied:false},policy:{starlinkHint:STARLINK_HINT,applyRoutes:APPLY_ROUTES,policy:'health-first; Starlink preferred only when healthy'}};}
if(import.meta.url===`file://${process.argv[1]}`)selectNetworkPath().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('[NETWORK SELECTOR]',e);process.exitCode=1;});
