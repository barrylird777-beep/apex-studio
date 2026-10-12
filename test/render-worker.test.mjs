import test from "node:test";
import assert from "node:assert/strict";
import { RenderWorker } from "../src/core/render-worker.mjs";

test("render worker reports unavailable binary without throwing",async()=>{
 const worker=new RenderWorker({ffmpegPath:"definitely-not-a-real-ffmpeg"});
 assert.equal(await worker.available(),false);
});
test("render worker refuses plans that are not ready",async()=>{
 const worker=new RenderWorker({ffmpegPath:"definitely-not-a-real-ffmpeg"});
 await assert.rejects(()=>worker.render({id:"r1",settings:{}},{ready:false,reason:"No visual media is attached yet."}),/No visual media/);
});
