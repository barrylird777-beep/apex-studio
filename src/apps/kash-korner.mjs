import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";
const APP=getApexApp("kash-korner");
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
export function recordCashEntry(input={}){const amount=n(input.amount);if(!amount)throw new Error("Cash entry amount must be non-zero");return{id:String(input.id||crypto.randomUUID()),account:String(input.account||"apex"),amount,currency:String(input.currency||"USD"),kind:String(input.kind||"transaction"),memo:String(input.memo||""),source:String(input.source||"manual"),createdAt:new Date().toISOString()};}
export function calculateCashBalance(entries=[]){return(Array.isArray(entries)?entries:[]).reduce((sum,entry)=>sum+n(entry.amount),0);}
export function cashFlowSummary(entries=[]){const rows=Array.isArray(entries)?entries:[],inflow=rows.filter(e=>n(e.amount)>0).reduce((s,e)=>s+n(e.amount),0),outflow=rows.filter(e=>n(e.amount)<0).reduce((s,e)=>s+n(e.amount),0);return{currency:rows[0]?.currency||"USD",inflow,outflow,balance:inflow+outflow,count:rows.length};}
export function kashKornerStatus(){return{app:{...APP},role:APP.role,capabilities:["cash ledger","cash balance","cash-flow summary","financial state"],canonical:true,checkedAt:new Date().toISOString()};}
