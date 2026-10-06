import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchPacket, scoreResearchResult, analyzeThroughput, compareAlgorithms } from '../src/core/research-packets.mjs';

test('research packets are deterministic and fingerprinted', () => {
  const p = createResearchPacket({ id:'r1', title:'Render test', question:'Which path is faster?' });
  assert.equal(p.id, 'r1');
  assert.equal(p.version, 1);
  assert.match(p.fingerprint, /^[a-f0-9]{64}$/);
});

test('analytical scoring handles tolerance and numeric error', () => {
  assert.equal(scoreResearchResult({ expected:100, observed:100, tolerance:1 }).score, 1);
  assert.equal(scoreResearchResult({ expected:100, observed:120 }).valid, true);
});

test('throughput analysis returns robust summary statistics', () => {
  const a = analyzeThroughput([10,20,30,40,50]);
  assert.equal(a.median, 30);
  assert.equal(a.p95, 50);
});

test('algorithm comparison ranks by score', () => {
  assert.deepEqual(compareAlgorithms([{id:'a',score:.4},{id:'b',score:.9}]).map(x=>x.id), ['b','a']);
});
