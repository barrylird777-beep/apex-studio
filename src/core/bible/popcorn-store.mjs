import { db } from "../../db/index.js";
import { bibleCollections, biblePassages, biblePopcorns } from "../../db/schema.js";
import { and, desc, eq, ilike, or, asc } from "drizzle-orm";

async function defaultCollectionId(){
  const found=await db.select({id:bibleCollections.id}).from(bibleCollections).where(and(eq(bibleCollections.ownerKey,"owner"),eq(bibleCollections.name,"My Bible"))).limit(1);
  if(found[0]) return found[0].id;
  const made=await db.insert(bibleCollections).values({name:"My Bible",description:"Apex personal Bible study collection",ownerKey:"owner"}).returning({id:bibleCollections.id});
  return made[0].id;
}
async function resolveCollection(value){return Number.isFinite(Number(value))&&Number(value)>0?Number(value):defaultCollectionId()}
export async function ensurePopcornSchema(){return true}
export async function upsertPopcorns(items=[]){
  const saved=[];
  for(const item of items){
    const collectionId=await resolveCollection(item.collectionId);
    let passage=(await db.select().from(biblePassages).where(and(eq(biblePassages.collectionId,collectionId),eq(biblePassages.reference,String(item.reference)))).limit(1))[0];
    if(!passage) throw new Error("CanonicalPassageNotFound:"+String(item.reference));
    const values={collectionId,passageId:passage.id,excerpt:String(item.excerpt||passage.text),reason:String(item.cinematicReason||""),characterPotential:item.characterMoment||null,visualPotential:item.visualMoment||null,dialoguePotential:item.dialoguePotential||null,conflictPotential:item.conflictTension||null,emotionalPotential:item.emotionalBeat||null,productionNotes:item.productionPotential||null,priority:Math.max(0,Math.min(100,Number(item.popcornRank)||0)),confidence:Math.max(0,Math.min(1,Number(item.confidence)||0)),verification:String(item.verificationStatus||"ai-review"),provenance:item.provenance||{} ,updatedAt:new Date()};
    const existing=(await db.select().from(biblePopcorns).where(and(eq(biblePopcorns.passageId,passage.id),eq(biblePopcorns.excerpt,values.excerpt))).limit(1))[0];
    saved.push(existing?(await db.update(biblePopcorns).set(values).where(eq(biblePopcorns.id,existing.id)).returning())[0]:(await db.insert(biblePopcorns).values(values).returning())[0]);
  }
  return saved;
}
export async function listPopcorns({collectionId,q="",limit=100,offset=0}={}){
  const cid=await resolveCollection(collectionId), text=String(q||"").trim(), f=[eq(biblePopcorns.collectionId,cid)];
  if(text) f.push(or(ilike(biblePopcorns.excerpt,"%"+text+"%"),ilike(biblePopcorns.reason,"%"+text+"%"),ilike(biblePassages.reference,"%"+text+"%")));
  const rows=await db.select({popcorn:biblePopcorns,passage:biblePassages}).from(biblePopcorns).innerJoin(biblePassages,eq(biblePopcorns.passageId,biblePassages.id)).where(and(...f)).orderBy(desc(biblePopcorns.priority),asc(biblePassages.reference)).limit(Math.min(500,Math.max(1,Number(limit)||100))).offset(Math.max(0,Number(offset)||0));
  return rows.map(x=>({...x.popcorn,reference:x.passage.reference,book:x.passage.book,chapter:x.passage.chapter,verseStart:x.passage.verseStart,verseEnd:x.passage.verseEnd}));
}
export async function getPopcorn(id){
  const rows=await db.select({popcorn:biblePopcorns,passage:biblePassages}).from(biblePopcorns).innerJoin(biblePassages,eq(biblePopcorns.passageId,biblePassages.id)).where(eq(biblePopcorns.id,Number(id))).limit(1);
  return rows[0]?{...rows[0].popcorn,reference:rows[0].passage.reference,book:rows[0].passage.book,chapter:rows[0].passage.chapter,verseStart:rows[0].passage.verseStart,verseEnd:rows[0].passage.verseEnd}:null;
}
export async function closePopcornStore(){}
