import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";
const APP=getApexApp("koin-kob");
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const uid=()=>crypto.randomUUID();

export function createWorkerAccount(input={}){return{workerId:String(input.workerId||uid()),balance:n(input.balance),reputation:n(input.reputation),skills:Array.isArray(input.skills)?input.skills.map(String):[],inventory:input.inventory&&typeof input.inventory==="object"?structuredClone(input.inventory):{},needs:Array.isArray(input.needs)?input.needs.map(String):[]};}
export function createMarketOrder(input={}){const side=String(input.side||"buy");if(!["buy","sell"].includes(side))throw new Error("Market order side must be buy or sell");const quantity=n(input.quantity),price=n(input.price);if(quantity<=0||price<0)throw new Error("Market order quantity/price is invalid");return{id:uid(),workerId:String(input.workerId||""),side,asset:String(input.asset||"service"),quantity,price,createdAt:new Date().toISOString()};}
export function clearMarket(orders=[]){const buys=(Array.isArray(orders)?orders:[]).filter(o=>o.side==="buy").map(o=>({...o})).sort((a,b)=>b.price-a.price),sells=(Array.isArray(orders)?orders:[]).filter(o=>o.side==="sell").map(o=>({...o})).sort((a,b)=>a.price-b.price),trades=[];let i=0,j=0;while(i<buys.length&&j<sells.length&&buys[i].price>=sells[j].price){const quantity=Math.min(buys[i].quantity,sells[j].quantity),price=(buys[i].price+sells[j].price)/2;trades.push({id:uid(),asset:buys[i].asset,quantity,price,buyer:buys[i].workerId,seller:sells[j].workerId,createdAt:new Date().toISOString()});buys[i].quantity-=quantity;sells[j].quantity-=quantity;if(buys[i].quantity<=0)i++;if(sells[j].quantity<=0)j++;}return{trades,unfilledBuys:buys.filter(o=>o.quantity>0),unfilledSells:sells.filter(o=>o.quantity>0)};}
export function createSystemicEvent(input={}){return{id:uid(),type:String(input.type||"resource-shortage"),severity:Math.max(0,Math.min(1,n(input.severity,.5))),target:String(input.target||"global"),payload:input.payload&&typeof input.payload==="object"?structuredClone(input.payload):{},createdAt:new Date().toISOString()};}
export function runAdversarialRound({workers=[],orders=[],events=[]}={}){const market=clearMarket(orders);return{roundId:uid(),workerCount:Array.isArray(workers)?workers.length:0,eventCount:Array.isArray(events)?events.length:0,trades:market.trades.length,volume:market.trades.reduce((s,t)=>s+t.quantity*t.price,0),unfilledBuys:market.unfilledBuys.length,unfilledSells:market.unfilledSells.length,generatedAt:new Date().toISOString()};}

export function buildWorkerEconomy({workerCount=2000,factions=["north","south","east","west"],governanceModels=["market","cooperative","centralized","mixed"]}={}){
  const count=Math.max(1,Math.floor(n(workerCount,2000)));
  const fs=Array.isArray(factions)&&factions.length?factions.map(String):["world"];
  const gs=Array.isArray(governanceModels)&&governanceModels.length?governanceModels.map(String):["market"];
  const workers=Array.from({length:count},(_,index)=>createWorkerAccount({
    workerId:"worker-"+String(index+1).padStart(4,"0"),
    skills:[["story","visual","audio","research","engineering","commerce"][index%6]],
    balance:100,
    reputation:50
  }));
  return {id:uid(),workerCount:count,factions:fs.map((name,index)=>({id:"faction-"+(index+1),name,governanceModel:gs[index%gs.length],workerCount:Math.floor(count/fs.length)+(index<count%fs.length?1:0)})),workers,createdAt:new Date().toISOString()};
}

export function runWorkerEconomySimulation({workerCount=2000,factions,governanceModels,orders=[],events=[]}={}){
  const world=buildWorkerEconomy({workerCount,factions,governanceModels});
  const generatedOrders=orders.length?orders:Array.from({length:Math.min(world.workerCount,400)},(_,index)=>createMarketOrder({
    workerId:world.workers[index].workerId,
    side:index%2===0?"buy":"sell",
    asset:["service","energy","media","food"][index%4],
    quantity:1+(index%3),
    price:5+(index%11)
  }));
  const result=runAdversarialRound({workers:world.workers,orders:generatedOrders,events});
  return {
    simulationId:world.id,
    workerCount:world.workerCount,
    factions:world.factions,
    eventMatrix:Array.isArray(events)?events:[],
    orders:generatedOrders.length,
    ...result,
    marketClearRate:generatedOrders.length?Number((result.trades*2/generatedOrders.length).toFixed(4)):0,
    researchQuestion:"Can 2,000 workers discover an efficient way to organize themselves without us explicitly programming the organization?"
  };
}

export function koinKobStatus(){return{app:{...APP},role:APP.role,capabilities:["worker accounts","barter","market orders","market clearing","systemic events","dynamic event matrix","adversarial rounds","2,000-worker economy simulation","economy-driven routing"],canonical:true,checkedAt:new Date().toISOString()};}
