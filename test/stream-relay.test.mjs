import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPassThroughArgs,buildTranscodeArgs,canCopyProbe,selectRelayMode} from '../src/core/stream-relay.mjs';

const probe=(video,audio)=>({streams:[{codec_type:'video',codec_name:video},{codec_type:'audio',codec_name:audio}]});

test('copy route accepts H264 plus AAC',()=>{
 const p=probe('h264','aac');
 assert.equal(canCopyProbe(p),true);
 assert.deepEqual(selectRelayMode(p),{mode:'copy',encoder:null});
 assert(buildPassThroughArgs({ingest:'in',dest:'out'}).includes('copy'));
});

test('copy route accepts HEVC plus MP3',()=>assert.equal(canCopyProbe(probe('hevc','mp3')),true));

test('incompatible codecs select CPU fallback',()=>{
 const r=selectRelayMode(probe('vp9','opus'));
 assert.deepEqual(r,{mode:'transcode',encoder:'libx264'});
 const a=buildTranscodeArgs({ingest:'in',dest:'out',encoder:r.encoder});
 assert(a.includes('ultrafast')&&a.includes('zerolatency')&&a.includes('aac'));
});

test('incompatible codecs can select NVENC',()=>assert.deepEqual(selectRelayMode(probe('vp9','opus'),{preferNvenc:true}),{mode:'transcode',encoder:'h264_nvenc'}));
