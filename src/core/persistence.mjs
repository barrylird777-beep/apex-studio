import fs from "node:fs/promises";
import path from "node:path";
export class JsonStore {
 constructor(file="./data/runtime/state.json"){this.file=file;}
 async load(fallback={}){try{return JSON.parse(await fs.readFile(this.file,"utf8"));}catch(e){if(e.code==="ENOENT")return fallback;throw e;}}
 async save(data){await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+".tmp";await fs.writeFile(tmp,JSON.stringify(data,null,2));await fs.rename(tmp,this.file);return data;}
}