import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPassThroughArgs,createStreamRelay} from '../src/core/stream-relay.mjs';

test('pass-through uses stream copy without transcoding',()=>{
 const a=buildPassThroughArgs({ingest:'rtmp://in',dest:'rtmp://out'});
 assert(a.includes('-c:v')&&a.includes('copy'));
 assert(a.includes('-c:a')&&a.includes('copy'));
 assert(!a.includes('libx264')&&!a.includes('aac'));
});
test('relay is disabled without endpoints',()=>{
 const r=createStreamRelay();
 assert.equal(r.status().status,'idle');
 assert.equal(r.status().configured,false);
});
