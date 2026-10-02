import fs from "node:fs";
import path from "node:path";
export class ApexDataPipeline {
  constructor(storageDir="./.apex_vault"){
    this.storagePath=path.resolve(storageDir);
    fs.mkdirSync(this.storagePath,{recursive:true,mode:0o700});
  }
  async safeWriteProjectRecord(recordId,payloadData){
    if(typeof recordId!=="string"||!/^[\w-]{1,100}$/.test(recordId)) throw new Error("Invalid record id");
    const filename=`${recordId}.json`;
    const targetPath=path.join(this.storagePath,filename);
    if(path.dirname(targetPath)!==this.storagePath) throw new Error("Scope escape detected");
    const body=JSON.stringify({timestamp:new Date().toISOString(),data:payloadData},null,2);
    const tmp=`${targetPath}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp,body,{mode:0o600});
    await fs.promises.rename(tmp,targetPath);
    return {status:"committed",target:filename};
  }
}