import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";
import { sovereignAppFabric } from "../core/sovereign-app-fabric.mjs";

const APP=getApexApp("kash-kobs");
const text=(value,max=2000)=>String(value??"").trim().slice(0,max);
const safeId=value=>{
  const id=text(value,128);
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)||id.includes("..")) throw new TypeError("KashKobs opportunity id is invalid");
  return id;
};

/**
 * Records a monetization hypothesis; it does not claim a sale, revenue, or
 * payment. Observed metrics must be supplied with their source and time window.
 */
export function createMonetizationOpportunity(input={}){
  if(!input||typeof input!=="object"||Array.isArray(input)) throw new TypeError("KashKobs input must be an object");
  const evidence=input.evidence&&typeof input.evidence==="object"&&!Array.isArray(input.evidence)?structuredClone(input.evidence):{};
  const metrics=input.metrics&&typeof input.metrics==="object"&&!Array.isArray(input.metrics)?structuredClone(input.metrics):{};
  return {
    id:safeId(input.id||crypto.randomUUID()),
    title:text(input.title,240)||"Untitled opportunity",
    description:text(input.description,4000),
    product:text(input.product,120)||"KernelVision",
    type:text(input.type,80)||"production-service",
    state:["idea","validated","offered","converting","paused","closed"].includes(input.state)?input.state:"idea",
    pricing:{amount:input.pricing?.amount==null?null:Number(input.pricing.amount),currency:text(input.pricing?.currency,3).toUpperCase()||"USD"},
    evidence:{...evidence,classification:evidence.classification||"unverified"},
    metrics,
    createdAt:input.createdAt||new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}

export function kashKobsStatus(){
  return {
    app:{...APP},
    role:APP.role,
    capabilities:["monetization opportunity records","evidence-labelled metrics","offer-state tracking","cross-app revenue intelligence"],
    revenueClaims:"observed-only; no sales or earnings inferred",
    persistence:"shared sovereign Pure-WAL namespace",
    canonical:true,
    checkedAt:new Date().toISOString()
  };
}

export const saveKashKobsOpportunity=(id,opportunity,fabric=sovereignAppFabric)=>fabric.put(APP.id,safeId(id),createMonetizationOpportunity({...opportunity,id}));
export const getKashKobsOpportunity=(id,fabric=sovereignAppFabric)=>fabric.get(APP.id,safeId(id));
export const listKashKobsOpportunities=(fabric=sovereignAppFabric)=>fabric.list(APP.id);
