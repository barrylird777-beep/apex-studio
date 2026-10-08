import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";
const APP=getApexApp("planet-apex");
const clone=value=>structuredClone(value);
const safeId=value=>{const id=String(value??"").trim();if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(id))throw new TypeError("PlanetApeX id is invalid");return id;};
export function createPlanet(input={}){return{id:safeId(input.id||crypto.randomUUID()),name:String(input.name||"PlanetApeX"),state:input.state&&typeof input.state==="object"?clone(input.state):{},regions:Array.isArray(input.regions)?clone(input.regions):[],entities:Array.isArray(input.entities)?clone(input.entities):[],createdAt:new Date().toISOString()};}
export function addPlanetRegion(planet,input={}){const next=clone(planet);next.regions=[...(next.regions||[]),{id:safeId(input.id||crypto.randomUUID()),name:String(input.name||"Unnamed region"),type:String(input.type||"region"),state:input.state&&typeof input.state==="object"?clone(input.state):{}}];return next;}
export function addPlanetEntity(planet,input={}){const next=clone(planet);next.entities=[...(next.entities||[]),{id:safeId(input.id||crypto.randomUUID()),kind:String(input.kind||"entity"),name:String(input.name||"Unnamed entity"),regionId:input.regionId?safeId(input.regionId):null,state:input.state&&typeof input.state==="object"?clone(input.state):{}}];return next;}
export function planetSnapshot(planet){return clone(planet);}
export function planetApexStatus(){return{app:{...APP},role:APP.role,capabilities:["world-registry","world-state","regions","entities","cross-app world context"],canonical:true,checkedAt:new Date().toISOString()};}
