import test from "node:test";
import assert from "node:assert/strict";
import { listVoiceOptions, generateSfx } from "../src/core/audio-station.mjs";

test("audio station exposes catalog voices without network",async()=>{
 const voices=await listVoiceOptions();
 assert.ok(voices.length>=10);
 assert.ok(voices.some(v=>v.engine==="piper"));
});

test("audio station generates local SFX through ffmpeg",async()=>{
 const r=await generateSfx({type:"tone",duration:.1,outputDir:"./data/test-audio"});
 assert.equal(r.type,"tone");
 assert.ok(r.bytes>0);
});
