import { randomUUID } from "node:crypto";
import { apexPureStore } from "../core/apex-pure-store.mjs";

const key=(c,id)=>`data:${c}:${id}`;
const normalizeId=x=>Number.isFinite(Number(x))?Number(x):String(x);
async function rows(c){return apexPureStore.list(key(c,"*"));}
async function all(c){return apexPureStore.query("data",r=>r.collection===c,{limit:100000}).then(xs=>xs.map(x=>x.record));}
async function nextId(c){const xs=await all(c);return xs.reduce((m,x)=>Math.max(m,Number(x.id)||0),0)+1;}
export async function listCollection(c){await apexPureStore.init();return all(c);}
export async function getCollection(c,id){await apexPureStore.init();return apexPureStore.get("data",key(c,id)).then(x=>x?.record??null);}
export async function putCollection(c,id,record){await apexPureStore.init();return apexPureStore.put("data",key(c,id),{collection:c,record:{...record,id:normalizeId(id)}}).then(x=>x.record);}
export async function createCollection(c,record){return putCollection(c,await nextId(c),record);}
export async function deleteCollection(c,id){const existing=await getCollection(c,id);if(!existing)return false;await apexPureStore.delete("data",key(c,id));return true;}
export async function replaceCollection(c,rows){for(const row of rows)await putCollection(c,row.id,row);return rows;}
export async function uuidCollection(c,record){return putCollection(c,randomUUID(),record);}
