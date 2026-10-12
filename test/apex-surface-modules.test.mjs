import test from 'node:test';
import assert from 'node:assert/strict';
import {buildRapidFfmpegArgs,APEX_RAPID_PROFILE} from '../src/core/apex-rapid.mjs';
import {createKornKnob} from '../src/core/korn-knob.mjs';
import {createGarden} from '../src/core/garden-of-apex.mjs';
import {createShieldApex} from '../src/core/shield-apex.mjs';
import {createPureStore} from '../src/core/apex-pure-store.mjs';
import {createRingWal} from '../src/core/apex-ring-wal.mjs';

test('rapid profile emits H264/AAC vertical mastering',()=>{const a=buildRapidFfmpegArgs({input:'in.mp4',output:'out.mp4'});assert.equal(APEX_RAPID_PROFILE.videoCodec,'libx264');assert.equal(APEX_RAPID_PROFILE.audioCodec,'aac');assert(a.join(' ').includes('1080:1920'));});
test('KORNKNOB registers and executes providers',async()=>{const k=createKornKnob({providers:{local:async x=>x.value}});assert.deepEqual(await k.run('local',{value:7}),7);assert.equal(k.status().providers[0],'local');});
test('Garden stores isolated snapshots',()=>{const g=createGarden();g.put('x',{value:1});const a=g.get('x');a.value=2;assert.equal(g.get('x').value,1);});
test('Shield authorizes configured boundaries',()=>{const s=createShieldApex({allowedOrigins:['https://example.test'],apiKeys:['k']});assert(s.authorizeOrigin('https://example.test'));assert(!s.authorizeOrigin('https://bad.test'));assert(s.authorizeApiKey('k'));});
test('persistent stores expose atomic filesystem primitives',async()=>{const dir='/tmp/apex-surface-test-'+Date.now();const s=createPureStore({root:dir});await s.write('state.json',{ok:true});assert.deepEqual(await s.read('state.json'),{ok:true});const w=createRingWal({file:dir+'/ring.jsonl'});await w.append('test',{ok:true});assert.equal((await w.readAll()).length,1);});
