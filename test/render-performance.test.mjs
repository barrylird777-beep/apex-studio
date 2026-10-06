import test from 'node:test';
import assert from 'node:assert/strict';
import { is4kMasterCompliant, selectEncoderFromList } from '../src/core/render-performance.mjs';

test('4K compliant source bypasses video re-encoding', () => {
  assert.equal(is4kMasterCompliant({video:{width:3840,height:2160,fps:24,codec:'h264',pixFmt:'yuv420p'}}), true);
  assert.equal(is4kMasterCompliant({video:{width:1920,height:1080,fps:24,codec:'h264',pixFmt:'yuv420p'}}), false);
});

test('encoder selection prefers available hardware and safely falls back to CPU', () => {
  assert.equal(selectEncoderFromList(['nvenc']).name, 'nvenc');
  assert.equal(selectEncoderFromList([]).name, 'cpu');
  assert.equal(selectEncoderFromList([], 'cpu').codec, 'libx264');
});

test('fast master decision can select stream-copy for compliant 4K video', async () => {
  const { buildFastMasterDecision } = await import('../src/core/ffmpeg.mjs');
  const d = buildFastMasterDecision({ video: { width:3840,height:2160,fps:24,codec:'h264',pixFmt:'yuv420p' } });
  assert.equal(d.mode, 'stream-copy-video');
});

test('bounded render pool never exceeds concurrency', async () => {
  const { buildRenderPool } = await import('../src/core/render-performance.mjs');
  const pool = buildRenderPool({ concurrency: 2 });
  let peak = 0, active = 0;
  const work = Array.from({ length: 6 }, (_, i) => pool.run(async () => {
    active++; peak = Math.max(peak, active);
    await new Promise(r => setTimeout(r, 2));
    active--; return i;
  }));
  const results = await Promise.all(work);
  assert.equal(peak, 2);
  assert.deepEqual(results, [0,1,2,3,4,5]);
});

test('hardware render profile increases bounded parallel capacity', async () => {
  const { buildRenderProfile, shouldStreamCopy } = await import('../src/core/render-performance.mjs');
  const p = buildRenderProfile({ availableEncoders: ['nvenc'], concurrency: 8 });
  assert.equal(p.encoder.codec, 'h264_nvenc');
  assert.equal(p.concurrency, 8);
  assert.equal(shouldStreamCopy({ probe: { video: { width:3840,height:2160,fps:24,codec:'h264',pixFmt:'yuv420p' } } }), true);
});
