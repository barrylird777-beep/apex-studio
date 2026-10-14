import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { APEX_APPS, assertSixAppInvariant, getApexApp, listApexApps } from "../src/apps/apex-six-apps.mjs";
import { planetApexStatus, createPlanet, addPlanetRegion, addPlanetEntity } from "../src/apps/planet-apex.mjs";
import { handlers as productionHandlers } from "../src/jobs/production-handlers.mjs";
import { defineKoBlock, composeKoBlocks, validateKoBlockGraph, koBlocksStatus } from "../src/apps/ko-blocks.mjs";
import { xshieldStatus, classifyXShieldRequest } from "../src/apps/xshield.mjs";
import { createTheatreItem, createViewingSession, kernelVisionStatus } from "../src/apps/kernel-vision.mjs";
import { createWorkerAccount, createMarketOrder, clearMarket, settleMarket, createSystemicEvent, runAdversarialRound, buildWorkerEconomy, runWorkerEconomySimulation, koinKobStatus, saveKoinKobRecord, listKoinKobRecords } from "../src/apps/koin-kob.mjs";
import { recordCashEntry, calculateCashBalance, cashFlowSummary, kashKornerStatus } from "../src/apps/kash-korner.mjs";
import { createMusicTrack, buildMusicProductionPlan, kernelodiesStatus } from "../src/apps/kernelodies.mjs";
import { buildPaypexBrief } from "../src/core/paypex-core.mjs";
import { buildEngineBrief } from "../src/core/engine-apex.mjs";

test("Apex exposes the six locked canonical apps",()=>{
  assert.equal(assertSixAppInvariant(),true);
  assert.deepEqual(listApexApps().map(app=>app.name),["PlanetApeX","XShield","KernelVision","KoinKob","KashKorner","Kernelodies"]);
  assert.equal(Object.keys(APEX_APPS).length,6);
});
test("all canonical registry entries point to real surfaces and modules",async()=>{
  for(const app of Object.values(APEX_APPS)){
    await access(resolve(process.cwd(),"public",app.entry === "/" ? "index.html" : app.entry.slice(1)));
    await access(resolve(process.cwd(),"src/apps",app.module.replace("../apps/","")));
  }
});

test("PlanetApeX home exposes exactly the six canonical app links",async()=>{
  const html=await readFile(resolve(process.cwd(),"public/index.html"),"utf8");
  const nav=html.match(/<nav class="apex-app-nav"[\s\S]*?<\/nav>/)?.[0];
  assert.ok(nav,"PlanetApeX home must show the canonical app switcher");
  for(const name of ["PlanetApeX","XShield","KernelVision","Kernelodies","KashKorner","KoinKob"]) assert.ok(nav.includes(name),name+" must be linked from PlanetApeX");
  assert.doesNotMatch(nav,/KoBlocks/,"KoBlocks is a legacy capability, not a canonical app");
  assert.match(nav,/aria-current="page"[^>]*title="THE BRAIN/);
});
test("PlanetApeX builds world state",()=>{
  let planet=createPlanet({id:"earth",name:"Test World"});
  planet=addPlanetRegion(planet,{id:"r1",name:"Region One"});
  planet=addPlanetEntity(planet,{id:"e1",name:"Entity One",regionId:"r1"});
  assert.equal(planet.regions.length,1); assert.equal(planet.entities[0].regionId,"r1");
  assert.equal(planetApexStatus().app.name,"PlanetApeX");
});
test("KoBlocks composes reusable blocks and rejects invalid execution graphs",()=>{
  const source=defineKoBlock({id:"source",outputs:["out"]});
  const target=defineKoBlock({id:"target",inputs:["in"],outputs:["out"]});
  const graph=composeKoBlocks([source,target],[{from:"source",to:"target",port:"out"}]);
  assert.equal(validateKoBlockGraph(graph).valid,true);
  const cyclic=composeKoBlocks([source,target],[{from:"source",to:"target",port:"out"},{from:"target",to:"source",port:"out"}]);
  assert.equal(validateKoBlockGraph(cyclic).reason,"cycle");
  assert.equal(koBlocksStatus().app.name,"KoBlocks");
  assert.equal(typeof koBlocksStatus().networkProtection.dns,"object");
  assert.equal(xshieldStatus().app.name,"XShield");
  assert.equal(getApexApp("xshield").name,"XShield");
  assert.equal(getApexApp("ko-blocks").name,"KoBlocks");
  assert.equal(classifyXShieldRequest("https://example.com").action,"allow");
});
test("KernelVision creates Theatre and Kornmax viewing sessions",()=>{
  const item=createTheatreItem({id:"film-1",title:"Finished Work"}),session=createViewingSession({item});
  assert.equal(session.theatre,"KernelVision Theatre"); assert.equal(session.display,"Kornmax");
  assert.equal(kernelVisionStatus().app.name,"KernelVision");
});
test("KoinKob clears a market and supports systemic events",()=>{
  const buyer=createWorkerAccount({workerId:"buyer",balance:100}),seller=createWorkerAccount({workerId:"seller",inventory:{service:1}});
  const orders=[createMarketOrder({workerId:buyer.workerId,side:"buy",asset:"service",quantity:1,price:10}),createMarketOrder({workerId:seller.workerId,side:"sell",asset:"service",quantity:1,price:8})];
  const market=clearMarket(orders); assert.equal(market.trades.length,1); assert.equal(market.trades[0].quantity,1);
  const differentAsset=clearMarket([
    createMarketOrder({workerId:buyer.workerId,side:"buy",asset:"energy",quantity:1,price:100}),
    createMarketOrder({workerId:seller.workerId,side:"sell",asset:"food",quantity:1,price:1})
  ]);
  assert.equal(differentAsset.trades.length,0);
  const settled=settleMarket([buyer,seller],market);
  assert.equal(settled.settled.length,1);
  assert.equal(settled.rejected.length,0);
  assert.equal(settled.accounts.find(account=>account.workerId==="buyer").inventory.service,1);
  const round=runAdversarialRound({workers:[buyer,seller],orders,events:[createSystemicEvent({type:"demand-spike"})]});
  assert.equal(round.workerCount,2); assert.equal(koinKobStatus().app.name,"KoinKob");
  assert.match(koinKobStatus().role,/autonomous economy/i);
  const world=buildWorkerEconomy({workerCount:2000});
  assert.equal(world.workerCount,2000);
  const simulation=runWorkerEconomySimulation({workerCount:2000,events:[createSystemicEvent({type:"infrastructure-breakdown",severity:.8})]});
  assert.equal(simulation.workerCount,2000);
  assert.ok(simulation.researchQuestion.includes("2,000 workers"));
  assert.ok(Array.isArray(simulation.eventMatrix));
  const baseline=runWorkerEconomySimulation({workerCount:20});
  assert.ok(baseline.settlement.settledTrades > 0);
  assert.ok(baseline.volume >= 0);
});
test("canonical apps reject malformed state instead of cloning garbage",()=>{
  assert.throws(() => createPlanet(null), /input must be an object/);
  assert.throws(() => addPlanetRegion(null,{id:"r1"}), /planet is required/);
  assert.throws(() => createTheatreItem(null), /item input must be an object/);
});


test("KernelVision returns the viewed item with a validated session id",()=>{
  const session=createViewingSession({item:{id:"film-1",title:"Finished Work"}});
  assert.equal(session.item.id,"film-1");
  assert.equal(session.itemId,"film-1");
  assert.match(session.sessionId,/^[A-Za-z0-9][A-Za-z0-9._:/-]+$/);
});

test("KoinKob rejects market orders without a worker identity",()=>{
  assert.throws(() => createMarketOrder({side:"buy",asset:"service",quantity:1,price:1}), /workerId is required/);
});

test("canonical status aggregator reports all six apps",async()=>{
  const { canonicalAppsStatus } = await import("../src/apps/canonical-six.mjs");
  const statuses = await canonicalAppsStatus();
  assert.equal(statuses.length,6);
  assert.deepEqual(statuses.map(status=>status.app.name),["PlanetApeX","XShield","KernelVision","KoinKob","KashKorner","Kernelodies"]);
});
test("KashKorner computes cash state",()=>{
  const entries=[recordCashEntry({amount:100}),recordCashEntry({amount:-25})];
  assert.equal(calculateCashBalance(entries),75);
  assert.deepEqual(cashFlowSummary(entries),{currency:"USD",inflow:100,outflow:-25,balance:75,count:2});
  assert.equal(kashKornerStatus().app.name,"KashKorner");
});
test("Kernelodies uses the existing music provenance contract",async()=>{
  const track=createMusicTrack({title:"Test",contentDomain:"original",role:"music",provenance:{source:"studio"}});
  const plan=buildMusicProductionPlan({projectId:"p1",contentDomain:"original",tracks:[track]});
  assert.equal(plan.contractVersion,"apex-music-production.v1"); assert.equal((await kernelodiesStatus()).app.name,"Kernelodies");
});
test("canonical app identities are internally consistent",async()=>{
  for(const [id,fn] of [["planet-apex",planetApexStatus],["xshield",xshieldStatus],["kernel-vision",kernelVisionStatus],["koin-kob",koinKobStatus],["kash-korner",kashKornerStatus]])assert.equal(fn().app.id,id);
  assert.equal((await kernelodiesStatus()).app.id,"kernelodies");
  for(const app of Object.values(APEX_APPS))assert.equal(getApexApp(app.id).name,app.name);
});


test("canonical trajectory forms a closed six-app contract",async()=>{
  const { canonicalTrajectory, canonicalNeighbors, validateCanonicalTrajectory } = await import("../src/apps/canonical-trajectory.mjs");
  const trajectory=canonicalTrajectory();
  assert.equal(trajectory.contractVersion,"apex-canonical-trajectory.v1");
  assert.equal(trajectory.apps.length,6);
  assert.equal(trajectory.handoffs.length,30);
  assert.equal(trajectory.closedLoop,true);
  assert.equal(canonicalNeighbors("planet-apex").length,10);
  assert.equal(validateCanonicalTrajectory(trajectory),true);
  assert.throws(()=>validateCanonicalTrajectory({...trajectory,apps:trajectory.apps.slice(0,5)}),/exactly six apps/);
  assert.throws(()=>canonicalNeighbors("not-an-app"),/Unknown Apex app/);
});


test("legacy music idea jobs report canonical app ownership", async () => {
  const result = await productionHandlers["kornknob.idea.evaluate"]({ payload: { title: "Test track concept", concept: "An original audio-first story" } });
  assert.equal(result.ownerApp, "Kernelodies");
  assert.equal(result.productionOwner, "KernelVision");
  assert.equal(result.durableEvaluation, true);
});


test("KoinKob simulation records persist through the shared Pure-WAL fabric", async () => {
  const records = new Map();
  const fabric = {
    async put(appId, id, record) {
      const entry = { appId, id, record, durable: true, storage: "content-addressed" };
      records.set(appId + ":" + id, entry);
      return entry;
    },
    async list(appId) {
      return [...records.values()].filter(entry => entry.appId === appId);
    }
  };
  const saved = await saveKoinKobRecord("simulation-test", {
    recordType: "simulation",
    createdAt: "2026-10-12T00:00:00.000Z",
    workerCount: 20,
    events: []
  }, fabric);
  assert.equal(saved.durable, true);
  const rows = await listKoinKobRecords(fabric);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].record.workerCount, 20);
  assert.equal(rows[0].record.recordType, "simulation");
});


test("all six canonical browser surfaces use the shared responsive UI system",async()=>{
  const surfaces=[
    ["KernelVision","kernel-vision.html"],
    ["XShield","xshield.html"],
    ["Kernelodies","kernelodies.html"],
    ["PlanetApeX","planet-apex.html"],
    ["KashKorner","kash-korner.html"],
    ["KoinKob","koin-kob.html"]
  ];
  for(const [name,file] of surfaces){
    const html=await readFile(resolve(process.cwd(),"public",file),"utf8");
    assert.match(html,/<link rel="stylesheet" href="\/apex-six-apps\.css">/,name+" must load the shared UI");
    assert.match(html,new RegExp('data-apex-app="[^"]+"'),name+" must expose an app-specific theme");
    assert.ok(html.includes('href="/'+file+'"'),name+" must appear in the app switcher");
    for (const [, canonicalFile] of surfaces) {
      assert.ok(html.includes('href="/'+canonicalFile+'"'), name+" app switcher must include "+canonicalFile);
    }
    assert.ok(html.includes('aria-current="page"'),name+" must identify the active app");
  }
  const kash=await readFile(resolve(process.cwd(),"public/kash-korner.html"),"utf8");
  assert.match(kash,/<h2>KashKorner Video Studio<\/h2>/,"the public video offer must use the canonical KashKorner name");
  assert.doesNotMatch(kash,/KornKash Video Studio/,"superseded app branding must not return");
  const css=await readFile(resolve(process.cwd(),"public/apex-six-apps.css"),"utf8");
  assert.match(css,/prefers-reduced-motion/,"shared UI must respect reduced motion");
  assert.match(css,/focus-visible/,"shared UI must expose keyboard focus");
  assert.match(css,/overflow-x:auto/,"app switcher must remain usable on narrow screens");
  const root=await readFile(resolve(process.cwd(),"public/index.html"),"utf8");
  assert.match(root,/APEX visual law: keep the main workspace still/,"PlanetApeX root must keep the restrained visual treatment");
  assert.match(root,/animation:none!important;transition:none!important/,"PlanetApeX root must not animate interface elements");
  assert.match(root,/button:hover,button:active\{transform:none!important/,"PlanetApeX controls must not pulse or scale");
});


test("legacy TeeVee and PayPex surfaces resolve to current canonical owners",()=>{
  const teevee=getApexApp("teevee");
  const paypex=getApexApp("paypex");
  assert.equal(teevee.system,"kernel-vision");
  assert.match(teevee.role,/24\/7 entertainment programming and broadcast surface owned by KernelVision/);
  assert.equal(paypex.system,"kash-korner");
  assert.match(paypex.role,/opportunity, market and monetization intelligence surface owned by KashKorner/);
  assert.deepEqual(listApexApps().map(app=>app.name),["PlanetApeX","XShield","KernelVision","KoinKob","KashKorner","Kernelodies"]);
});

test("KernelVision registry assigns the continuous network and keeps Theatre/Kornmax as playback experiences",()=>{
  const app=getApexApp("kernel-vision");
  assert.match(app.role,/24\/7 original entertainment stream/);
  assert.match(app.role,/Theatre and Kornmax are playback experiences/);
});

test("KernelVision presents the continuous network as canonical and Theatre as a playback capability",async()=>{
  const page=await readFile(resolve(process.cwd(),"public/kernel-vision.html"),"utf8");
  const hub=await readFile(resolve(process.cwd(),"src/pages/SixAppHub.tsx"),"utf8");
  assert.match(page,/24\/7 original entertainment network/i);
  assert.match(page,/api\/apex\/apps\/teevee\/status/);
  assert.match(page,/href="\/teevee\.html"/);
  assert.match(page,/Theatre and Kornmax remain playback experiences/);
  assert.match(hub,/24\/7 entertainment stream/);
  assert.match(hub,/href: "\/teevee\.html"/);
});

test("legacy TeeVee pages identify KernelVision as their canonical owner",async()=>{
  const network=await readFile(resolve(process.cwd(),"public/teevee.html"),"utf8");
  const buyer=await readFile(resolve(process.cwd(),"public/teevee-buyer.html"),"utf8");
  assert.match(network,/KernelVision owns the continuous network/);
  assert.match(network,/href="\/kernel-vision\.html">KernelVision/);
  assert.match(buyer,/historical name for KernelVision's 24\/7 original animated entertainment network/);
  assert.match(buyer,/not a separate canonical app/);
});

test("absorbed Garden, PayPex, and EngineApex pages use current canonical ownership",async()=>{
  const garden=await readFile(resolve(process.cwd(),"public/garden-of-apex.html"),"utf8");
  const paypex=await readFile(resolve(process.cwd(),"public/paypex.html"),"utf8");
  const engine=await readFile(resolve(process.cwd(),"public/engine-apex.html"),"utf8");
  const nav=garden.match(/<nav aria-label="Six canonical apps">[\s\S]*?<\/nav>/)?.[0]||"";
  for(const name of ["PlanetApeX","XShield","KernelVision","Kernelodies","KashKorner","KoinKob"]) assert.ok(nav.includes(name),name+" must appear in GardenApex canonical navigation");
  assert.doesNotMatch(nav,/TeeVee|PayPex|KoBlocks|ShieldApex/);
  assert.match(garden,/GardenApex is the living universe inside PlanetApeX—not a separate app/);
  assert.match(paypex,/historical opportunity, market and monetization engine now owned by KashKorner/);
  assert.match(paypex,/KernelVision owns production execution/);
  assert.match(engine,/historical opportunity-decision capability now assigned to KashKorner/);
  assert.match(engine,/production execution belongs to KernelVision/);
});

test("legacy EngineApex and ShieldApex capabilities resolve to canonical owners",()=>{
  assert.equal(getApexApp("engine-apex").system,"kash-korner");
  assert.equal(getApexApp("shield-apex").system,"xshield");
  assert.equal(getApexApp("apex-adblocker").system,"xshield");
  assert.equal(getApexApp("garden-of-apex").system,"planet-apex");
  assert.equal(getApexApp("korn-knob").system,"kernelodies");
  assert.equal(getApexApp("ko-blocks").name,"KoBlocks");
  assert.equal(listApexApps().length,6);
});

test("legacy Music Radar bridge follows Kernelodies-to-KernelVision production ownership",async()=>{
  const page=await readFile(resolve(process.cwd(),"public/korn-knob.html"),"utf8");
  assert.match(page,/Music Radar is a Kernelodies discovery and integration surface, not a separate production authority/);
  assert.match(page,/KernelVision owns final audiovisual production/);
  assert.match(page,/KernelVision URL/);
});
test("ShieldApex status reports XShield as the canonical owner",async()=>{
  const server=await readFile(resolve(process.cwd(),"server.mjs"),"utf8");
  const page=await readFile(resolve(process.cwd(),"public/shield-apex.html"),"utf8");
  assert.match(server,/app\.get\('\/api\/shield-apex\/status'[\s\S]*?system: 'xshield'[\s\S]*?ownerApp: 'XShield'/);
  assert.match(page,/ShieldApex is a historical security-boundary implementation now owned by XShield/);
});

test("GardenApex legacy page does not restore obsolete three-system ownership",async()=>{
  const page=await readFile(resolve(process.cwd(),"public/garden-of-apex.html"),"utf8");
  assert.match(page,/PlanetApeX owns Bible study, research, knowledge, analytics, and the GardenApex living universe/);
  assert.match(page,/KernelVision owns production/);
  assert.doesNotMatch(page,/Apex Studio owns production|KORNKNOB supplies computational/);
});

test("PayPex opportunity engine now hands off to KashKorner and KernelVision",()=>{
  const brief=buildPaypexBrief({topic:"Historical lineage test"});
  assert.equal(brief.system,"kash-korner");
  assert.equal(brief.handoff,"KernelVision");
  assert.equal(brief.engine,"PayPex");
});
test("PayPex compatibility wrapper reports KernelVision as production owner",async()=>{
  const { createPayPexBrief }=await import("../src/apps/paypex.mjs");
  const brief=createPayPexBrief({topic:"Historical lineage test"});
  assert.equal(brief.app.name,"PayPex");
  assert.equal(brief.system,"kash-korner");
  assert.equal(brief.executionOwner,"KernelVision");
});

test("rapid-video storefront is presented as KashKorner's public offer",async()=>{
  const page=await readFile(resolve(process.cwd(),"public/rapid-video.html"),"utf8");
  assert.match(page,/<title>KashKorner · Public Rapid Video Offer<\/title>/);
  assert.match(page,/KashKorner home/);
  assert.match(page,/KASHKORNER<\/b> · PUBLIC RAPID-VIDEO OFFER/);
});

test("EngineApex opportunity engine now hands off to KashKorner and KernelVision",()=>{
  const brief=buildEngineBrief({topic:"Historical lineage test"});
  assert.equal(brief.system,"kash-korner");
  assert.equal(brief.handoff,"KernelVision");
  assert.equal(brief.engine,"EngineApex");
});
