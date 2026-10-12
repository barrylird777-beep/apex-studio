import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Rapid preview and paid render produce playable MP4 files', async () => {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  const dir = await mkdtemp(path.join(os.tmpdir(), 'apex-rapid-'));
  const previous = process.env.STORAGE_DIR;
  process.env.STORAGE_DIR = dir;
  try {
    const { executeRapidVideoPreview, executeRapidVideoOrder } = await import('../src/workers/rapid-video-worker.mjs');
    const preview = await executeRapidVideoPreview({
      orderId: 'smoke-preview',
      name: 'Smoke Buyer',
      type: 'Product',
      brief: 'A cinematic product launch with a hard opening hook.',
      platform: 'TikTok'
    });
    const order = await executeRapidVideoOrder({
      orderId: 'smoke-order',
      name: 'Smoke Buyer',
      email: 'buyer@example.com',
      type: 'Product',
      brief: 'A cinematic product launch with a hard opening hook.',
      platform: 'TikTok'
    });
    for (const result of [preview, order]) {
      assert.equal(result.format, 'mp4');
      assert.match(result.url, /\.mp4$/);
    }
    const previewPath = path.join(dir, 'previews', 'rapid_preview_smoke-preview.mp4');
    const orderPath = path.join(dir, 'rapid_order_smoke-order.mp4');
    for (const file of [previewPath, orderPath]) {
      const info = await stat(file);
      assert.ok(info.size > 50000, `render too small: ${file}`);
      const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], { encoding: 'utf8' }).trim();
      assert.ok(Number(probe) > 1, `invalid duration: ${file}`);
    }
  } finally {
    if (previous === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
