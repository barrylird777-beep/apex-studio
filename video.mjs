import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
export function safeProcessVideoChunk(videoFileName,outputDir,inputDir=outputDir){
  return new Promise((resolve,reject)=>{
    const name=path.basename(String(videoFileName));
    if(!/^\w[\w.-]*$/.test(name)) return reject(new Error("Invalid video file name"));
    const outDir=path.resolve(outputDir),inDir=path.resolve(inputDir);
    const sourcePath=path.join(inDir,name),targetPath=path.join(outDir,`processed_${name}`);
    if(path.dirname(sourcePath)!==inDir) return reject(new Error("Directory escape blocked"));
    if(!fs.existsSync(sourcePath)) return reject(new Error("Source file not found"));
    const args=["-nostdin","-hide_banner","-y","-i",sourcePath,"-c:v","libx264","-crf","23","-preset","veryfast","-c:a","aac","-b:a","128k",targetPath];
    console.log(`[PIPELINE START] ${name}`);
    const proc=spawn("ffmpeg",args,{shell:false,env:{PATH:process.env.PATH},cwd:outDir});
    proc.stderr.on("data",(d)=>console.log(`[FFMPEG] ${d.toString().trim()}`));
    proc.on("error",(err)=>reject(new Error(`ffmpeg failed to start: ${err.message}`)));
    proc.on("close",(code)=>code===0?resolve({success:true,artifact:targetPath}):reject(new Error(`ffmpeg exited with code ${code}`)));
  });
}