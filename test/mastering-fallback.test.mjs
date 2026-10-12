import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { masterSoundtrack } from "../src/core/mastering.mjs";

const exec=promisify(execFile);

test("mastering creates a local 432 Hz reference bed when no music file exists",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"apex-mastering-fallback-"));
  try{
    const voice=path.join(root,"voice.wav"),out=path.join(root,"master.m4a");
    await exec(process.env.FFMPEG_PATH||"ffmpeg",["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","sine=frequency=660:sample_rate=48000:duration=2","-ac","2","-c:a","pcm_s16le",voice]);
    await masterSoundtrack([{filePath:voice,startTimeMs:0,durationMs:2000}],null,out);
    const info=await stat(out);
    assert.ok(info.size>1000);
    const {stdout}=await exec(process.env.FFPROBE_PATH||"ffprobe",["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1",out]);
    assert.ok(Math.abs(Number(stdout.trim())-2)<0.5);
  }finally{await rm(root,{recursive:true,force:true});}
});
