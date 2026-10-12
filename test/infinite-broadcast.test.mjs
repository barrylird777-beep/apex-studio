import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRtmpFfmpegArgs, createInfiniteBroadcast } from '../src/core/infinite-broadcast.mjs';

test('RTMP plan uses H.264/AAC and FLV transport', () => {
  const args = buildRtmpFfmpegArgs({ input: '/tmp/show.mp4', rtmpUrl: 'rtmp://example.test/live/key' });
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('flv'));
});

test('broadcast controller stays disabled without destination', () => {
  const controller = createInfiniteBroadcast({ inputDir: '/tmp/nonexistent', rtmpUrl: '' });
  assert.equal(controller.status().configured, false);
  assert.equal(controller.status().status, 'idle');
});
