import fs from "node:fs/promises";

const REQUIRED = Object.freeze([
  ["KORNKNOB","public/korn-knob.html"],
  ["ApexStudios","public/index.html"],
  ["GardenOfApex","public/garden-of-apex.html"],
  ["EngineApex","public/engine-apex.html"],
  ["Apexus","public/apexus-buyer.html"],
  ["ShieldApex","public/shield-apex.html"]
]);

const FORBIDDEN_CANON_NAMES = ["ApexOpportunity","ApexAdBlocker","ApexRapid","KORNKOB"];
const results=[];

for (const [surface,file] of REQUIRED) {
  try {
    const stat=await fs.stat(file);
    results.push({surface,file,exists:true,bytes:stat.size});
  } catch {
    results.push({surface,file,exists:false,bytes:0});
  }
}

const packageJson=JSON.parse(await fs.readFile("package.json","utf8"));
const requiredScripts=["apexus:bootstrap","apexus:prepare","apexus:schedule","apexus:worker","apexus:buyer-audit"];
const scripts=Object.fromEntries(requiredScripts.map(name=>[name,typeof packageJson.scripts?.[name]==="string"]));

const runtimeFiles=["server.mjs","src","public","test"];
const sources=[];
async function collect(entry){
  let stat;
  try{stat=await fs.stat(entry)}catch{return}
  if(stat.isDirectory){
    for(const child of await fs.readdir(entry)) await collect(entry+"/"+child);
    return;
  }
  if(/\\.(mjs|js|html|json)$/.test(entry)){
    sources.push(await fs.readFile(entry,"utf8"));
  }
}
for(const entry of runtimeFiles) await collect(entry);
const forbiddenHits=FORBIDDEN_CANON_NAMES.filter(name=>sources.some(source=>source.includes(name)));

const ready =
  results.every(item=>item.exists && item.bytes>0) &&
  Object.values(scripts).every(Boolean) &&
  forbiddenHits.length===0;

console.log(JSON.stringify({
  product:"Apex",
  surfaces:results,
  requiredScripts:scripts,
  forbiddenCanonHits:forbiddenHits,
  buyerGate:"payment-ready-not-live",
  ready
},null,2));

if (!ready) process.exitCode=2;
