import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { APEX_APPS, assertSixAppInvariant, getApexApp, listApexApps } from "../src/apps/apex-six-apps.mjs";
import { planetApexStatus, createPlanet, addPlanetRegion, addPlanetEntity } from "../src/apps/planet-apex.mjs";
import { defineKoBlock, composeKoBlocks, validateKoBlockGraph, koBlocksStatus } from "../src/apps/ko-blocks.mjs";
import { createTheatreItem, createViewingSession, kernelVisionStatus } from "../src/apps/kernel-vision.mjs";
import { createWorkerAccount, createMarketOrder, clearMarket, settleMarket, createSystemicEvent, runAdversarialRound, buildWorkerEconomy, runWorkerEconomySimulation, koinKobStatus } from "../src/apps/koin-kob.mjs";
import { recordCashEntry, calculateCashBalance, cashFlowSummary, kashKornerStatus } from "../src/apps/kash-korner.mjs";
import { createMusicTrack, buildMusicProductionPlan, kernelodiesStatus } from "../src/apps/kernelodies.mjs";

test("Apex exposes the six locked canonical apps",()=>{
  assert.equal(assertSixAppInvariant(),true);
  assert.deepEqual(listApexApps().map(app=>app.name),["PlanetApeX","KoBlocks","KernelVision","KoinKob","KashKorner","Kernelodies"]);
  assert.equal(Object.keys(APEX_APPS).length,6);
});
test("all canonical registry entries point to real surfaces and modules",async()=>{
  for(const app of Object.values(APEX_APPS)){
    await access(resolve(process.cwd(),"public",app.entry.slice(1)));
    await access(resolve(process.cwd(),"src/apps",app.module.replace("../apps/","")));
  }
});
test("PlanetApeX builds world state",()=>{
  let planet=createPlanet({id:"earth",name:"Test World"});
  planet=addPlanetRegion(planet,{id:"r1",name:"Region One"});
  planet=addPlanetEntity(planet,{id:"e1",name:"Entity One",regionId:"r1"});
  assert.equal(planet.regions.length,1); assert.equal(planet.entities[0].regionId,"r1");
  assert.equal(planetApexStatus().app.name,"PlanetApeX");
});
test("KoBlocks composes and validates reusable blocks",()=>{
  const a=defineKoBlock({id:"a",outputs:["out"]}),b=defineKoBlock({id:"b",inputs:["in"]});
  const graph=composeKoBlocks([a,b],[{from:"a",to:"b",port:"out"}]);
  assert.deepEqual(validateKoBlockGraph(graph),{valid:true,blockCount:2,edgeCount:1});
  assert.equal(koBlocksStatus().app.name,"KoBlocks");
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
test("KashKorner computes cash state",()=>{
  const entries=[recordCashEntry({amount:100}),recordCashEntry({amount:-25})];
  assert.equal(calculateCashBalance(entries),75);
  assert.deepEqual(cashFlowSummary(entries),{currency:"USD",inflow:100,outflow:-25,balance:75});
  assert.equal(kashKornerStatus().app.name,"KashKorner");
});
test("Kernelodies uses the existing music provenance contract",async()=>{
  const track=createMusicTrack({title:"Test",contentDomain:"original",role:"music",provenance:{source:"studio"}});
  const plan=buildMusicProductionPlan({projectId:"p1",contentDomain:"original",tracks:[track]});
  assert.equal(plan.contractVersion,"apex-music-production.v1"); assert.equal((await kernelodiesStatus()).app.name,"Kernelodies");
});
test("canonical app identities are internally consistent",async()=>{
  for(const [id,fn] of [["planet-apex",planetApexStatus],["ko-blocks",koBlocksStatus],["kernel-vision",kernelVisionStatus],["koin-kob",koinKobStatus],["kash-korner",kashKornerStatus]])assert.equal(fn().app.id,id);
  assert.equal((await kernelodiesStatus()).app.id,"kernelodies");
  for(const app of Object.values(APEX_APPS))assert.equal(getApexApp(app.id).name,app.name);
});
