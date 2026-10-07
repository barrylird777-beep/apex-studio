import fs from 'node:fs/promises';
import path from 'node:path';

export function createPureStore({root='/srv/apex/se-x/projects'}={}) {
  async function ensure(){await fs.mkdir(root,{recursive:true});}
  async function read(name,fallback=null){await ensure();try{return JSON.parse(await fs.readFile(path.join(root,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
  async function write(name,value){await ensure();const target=path.join(root,name);const tmp=target+'.tmp-'+process.pid+'-'+Date.now();await fs.writeFile(tmp,JSON.stringify(value,null,2)+'\n','utf8');await fs.rename(tmp,target);return target;}
  return {root,ensure,read,write};
}
