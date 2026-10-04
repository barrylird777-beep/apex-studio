import fs from "node:fs/promises";
import path from "node:path";
import catalog from "../data/bible/catalog.json" with { type:"json" };
import { db } from "../src/db/index.js";
import { bibleCollections, bibleSources, biblePassages } from "../src/db/schema.js";
import { eq, and } from "drizzle-orm";

const root=path.resolve(process.env.APEX_BIBLE_DIR||"./data/bibles");
const slugs=process.argv.slice(2).filter(x=>x!=="--all");
const editions=catalog.editions.filter(x=>process.argv.includes("--all")||slugs.includes(x.slug));
if(!editions.length)throw Error("Choose --all or edition slugs");

function normalizeBooks(doc){
  const books=Array.isArray(doc)?doc:(doc.books||doc.data||[]);
  return books.flatMap((book,bi)=>{
    const chapters=book.chapters||book.chapter||[];
    if(Array.isArray(chapters)&&chapters.length)return chapters.flatMap((chapter,ci)=>{
      const verses=chapter.verses||chapter;
      return Array.isArray(verses)?verses.map((v,vi)=>({book:book.name||book.title||book.book,chapter:Number(chapter.chapter||chapter.number||ci+1),verse:Number(v.verse||v.number||vi+1),text:String(v.text||v.value||v.content||"").trim()})):[]});
    return [];
  }).filter(x=>x.book&&x.text);
}
for(const edition of editions){
  const file=path.join(root,edition.slug,edition.slug+".json"),raw=JSON.parse(await fs.readFile(file,"utf8"));
  let collection=(await db.select({id:bibleCollections.id}).from(bibleCollections).where(and(eq(bibleCollections.ownerKey,"owner"),eq(bibleCollections.name,edition.name))).limit(1))[0];
  if(!collection)collection=(await db.insert(bibleCollections).values({name:edition.name,description:"Imported canonical Bible edition",ownerKey:"owner"}).returning({id:bibleCollections.id}))[0];
  let source=(await db.select({id:bibleSources.id}).from(bibleSources).where(and(eq(bibleSources.collectionId,collection.id),eq(bibleSources.name,edition.name))).limit(1))[0];
  if(!source)source=(await db.insert(bibleSources).values({collectionId:collection.id,sourceType:"local-corpus",name:edition.name,version:edition.slug,language:edition.language,license:edition.license,uri:edition.source||null,metadata:{upstream:"midvash/bible-data"}}).returning({id:bibleSources.id}))[0];
  const verses=normalizeBooks(raw);
  for(let i=0;i<verses.length;i+=500){
    const batch=verses.slice(i,i+500).map(v=>({collectionId:collection.id,sourceId:source.id,reference:v.book+" "+v.chapter+":"+v.verse,book:v.book,chapter:v.chapter,verseStart:v.verse,verseEnd:v.verse,text:v.text,canonical:1,metadata:{edition:edition.slug}}));
    await db.insert(biblePassages).values(batch).onConflictDoNothing();
  }
  console.log(JSON.stringify({edition:edition.slug,collectionId:collection.id,verses:verses.length}));
}
process.exit(0);
