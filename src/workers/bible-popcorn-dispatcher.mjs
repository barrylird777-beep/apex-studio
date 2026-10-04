import crypto from "node:crypto";
import { db } from "../db/index.js";
import { biblePassages, biblePopcorns } from "../db/schema.js";
import { and, eq, notExists } from "drizzle-orm";
import { enqueuePopcornPassages } from "./popcorn-worker.mjs";

const SCAN_MS=Math.max(1000,Number(process.env.APEX_BIBLE_POPCORN_SCAN_MS||2000));
const SCAN_SIZE=Math.max(100,Math.min(5000,Number(process.env.APEX_BIBLE_POPCORN_SCAN_SIZE||1000)));

export async function dispatchUnprocessedPopcorns({collectionId,limit=SCAN_SIZE}={}){
  const where=collectionId?eq(biblePassages.collectionId,Number(collectionId)):undefined;
  const rows=await db.select({id:biblePassages.id}).from(biblePassages).where(where?and(where,notExists(db.select({id:biblePopcorns.id}).from(biblePopcorns).where(eq(biblePopcorns.passageId,biblePassages.id)))):notExists(db.select({id:biblePopcorns.id}).from(biblePopcorns).where(eq(biblePopcorns.passageId,biblePassages.id)))).orderBy(biblePassages.id).limit(limit);
  if(!rows.length)return[];
  return enqueuePopcornPassages(rows.map(x=>x.id));
}
export function startBiblePopcornDispatcher(){
  let stopped=false,inFlight=false;
  async function tick(){if(stopped||inFlight)return;inFlight=true;try{await dispatchUnprocessedPopcorns()}catch(e){console.error("[bible-popcorn-dispatcher]",e?.message||e)}finally{inFlight=false;if(!stopped)setTimeout(tick,SCAN_MS).unref?.()}}
  void tick();return{stop(){stopped=true}};
}
