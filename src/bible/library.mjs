import fs from "node:fs/promises";
import path from "node:path";

export async function loadBibleEdition(root,slug){
 const file=path.join(root,slug,slug+".json");
 const text=await fs.readFile(file,"utf8");
 return JSON.parse(text);
}
export async function searchBibleEdition(root,slug,query,{limit=50}={}){
 const bible=await loadBibleEdition(root,slug),q=String(query).toLowerCase().trim(),hits=[];
 for(const book of bible.books??[])for(let ci=0;ci<(book.chapters??[]).length;ci++)for(const verse of book.chapters[ci].verses??[]){
  if(String(verse.text??"").toLowerCase().includes(q)){hits.push({version:slug,book:book.book,chapter:ci+1,verse:verse.number,text:verse.text});if(hits.length>=limit)return hits;}
 }
 return hits;
}
export function listInstalledEditions(root,fsEntries){
 return fsEntries.filter(x=>x.isDirectory()).map(x=>x.name);
}
