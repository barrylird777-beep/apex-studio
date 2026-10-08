import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";
const APP=getApexApp("kernel-vision");
const clone=value=>structuredClone(value);
export function createTheatreItem(input={}){return{id:String(input.id||crypto.randomUUID()),title:String(input.title||"Untitled"),mediaUrl:String(input.mediaUrl||""),kind:String(input.kind||"finished-work"),status:String(input.status||"ready"),provenance:input.provenance&&typeof input.provenance==="object"?clone(input.provenance):null,createdAt:new Date().toISOString()};}
export function createViewingSession(input={}){const item=createTheatreItem(input.item||input);return{sessionId:String(input.sessionId||crypto.randomUUID()),itemId:item.id,display:"Kornmax",theatre:"KernelVision Theatre",mode:String(input.mode||"cinematic"),startedAt:new Date().toISOString()};}
export function kernelVisionStatus(){return{app:{...APP},role:APP.role,theatre:"KernelVision Theatre",display:"Kornmax",capabilities:["finished-work viewing","cinematic display","viewing sessions","provenance display"],canonical:true,checkedAt:new Date().toISOString()};}
