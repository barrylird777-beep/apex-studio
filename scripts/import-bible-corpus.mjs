import fs from "node:fs/promises";
import path from "node:path";
import catalog from "../data/bible/catalog.json" with { type:"json" };

const root=path.resolve(process.env.APEX_BIBLE_DIR||"./data/bibles");
const wanted=new Set(process.argv.slice(2).filter(x=>x!=="--all"));
const editions=catalog.editions.filter(x=>process.argv.includes("--all")||wanted.has(x.slug));
if(!editions.length)throw new Error("Choose --all or one/more edition slugs, e.g. npm run bible:import -- kjv web");
await fs.mkdir(root,{recursive:true});
for(const e of editions){
 const dir=path.join(root,e.slug);await fs.mkdir(dir,{recursive:true});
 const url=`https://raw.githubusercontent.com/midvash/bible-data/main/versions/${e.language}/${e.slug}/${e.slug}.json`;
 const res=await fetch(url);if(!res.ok)throw new Error(`${e.slug}: HTTP ${res.status}`);
 const text=await res.text();JSON.parse(text);
 await fs.writeFile(path.join(dir,e.slug+".json"),text+"\n");
 await fs.writeFile(path.join(dir,"metadata.json"),JSON.stringify({...e,source:url,importedAt:new Date().toISOString()},null,2)+"\n");
 console.log(`Imported ${e.name} (${e.slug})`);
}
