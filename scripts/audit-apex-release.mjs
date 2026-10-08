import fs from "node:fs/promises";

const REQUIRED = Object.freeze([
  ["Apex Studio","public/index.html"],
  ["Apex Rapid Production","public/rapid-video.html"],
  ["Garden of Apex","public/garden-of-apex.html"],
  ["KORNKNOB","public/korn-knob.html"],
  ["TOONX","public/toonx-buyer.html"],
  ["Apex Overseer","public/overseer.html"],
  ["Engine Apex","src/core/engine-apex.mjs"],
  ["ShieldApex","src/core/shield-apex.mjs"]
]);

const FORBIDDEN_CANON_NAMES = ["ApexOpportunity","ApexAdBlocker","ApexRapid","KORNKOB","Apexus","APEXUS"];
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
const requiredScripts=["toonx:bootstrap","toonx:prepare","toonx:schedule","toonx:worker"];
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
  if(/\.(mjs|js|html|json)$/.test(entry)){
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
