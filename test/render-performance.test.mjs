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
