import { mkdir } from "node:fs/promises";
import path from "node:path";
import { TitanPathJail } from "../security/titan-path-jail.mjs";

export class RenderOrchestrator {
  constructor(workspaceRoot=process.cwd()){this.jail=new TitanPathJail(workspaceRoot);}
  async renderScene(sceneId,scriptText,outputPath){
    const safeOutputPath=this.jail.enforceStrictBoundary(outputPath);
    const safeSceneId=String(sceneId||"").replace(/[^a-zA-Z0-9._-]/g,"_");
    if(!safeSceneId) throw new Error("RENDER_FAILED: invalid scene id");
    await mkdir(path.dirname(safeOutputPath),{recursive:true});
    return {sceneId:safeSceneId,outputPath:safeOutputPath,scriptLength:String(scriptText||"").length,status:"planned"};
  }
}
