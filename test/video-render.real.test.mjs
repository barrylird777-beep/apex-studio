import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pcmToWav } from '../src/video/wav.mjs';
import { assembleVideo, probeVideo, checkSpec } from '../src/video/assemble.mjs';

const run = promisify(execFile);
const have = (bin) => spawnSync(bin, ['-version']).status === 0;
const HAVE = have('ffmpeg') && have('ffprobe');
const MOTIONS = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'];
const COLORS = ['0x8b0000', '0x1a1a40', '0x2f4f2f', '0x4b3621', '0x202020'];

async function png(file, color) {
  const { stdout } = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080`,
    '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-',
  ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(file, stdout);
}

const sine = (sec, rate = 24000, freq = 440) => {
  const n = Math.round(sec * rate);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 8000), i * 2);
  return b;
};

async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'apex-render-'));
  const shots = [];
  for (let i = 0; i < 10; i++) {
    const image = path.join(dir, `i${i}.png`);
    await png(image, COLORS[i % COLORS.length]);
    shots.push({ id: `s${i}`, image, durationSec: 3, motion: MOTIONS[i % 4], narration: `Line ${i}.` });
  }
  const narration = path.join(dir, 'narration.wav');
  writeFileSync(narration, pcmToWav(sine(30), 24000));
  const music = path.join(dir, 'music.wav');
  writeFileSync(music, pcmToWav(sine(5, 24000, 660), 24000));
  return { dir, shots, narration, music };
}

test('real ffmpeg: 10 shots render to a valid 1080p h264/aac mp4 of the right length', { skip: !HAVE, timeout: 300_000 }, async () => {
  const { dir, shots, narration } = await fixture();
  const outPath = path.join(dir, 'hook.mp4');
  const r = await assembleVideo({ shots, narration, outPath });
  assert.ok(existsSync(outPath) && statSync(outPath).size > 10_000, 'mp4 exists and is not trivial');
  assert.ok(existsSync(r.srtPath), 'srt written');
  const p = await probeVideo(outPath);
  const s = checkSpec(p, { expectedSec: 30 });
  assert.deepEqual(s.errors, []);
  assert.equal(s.ok, true);
});

test('real ffmpeg: background music path (amix + loop) renders and keeps the spec', { skip: !HAVE, timeout: 300_000 }, async () => {
  const { dir, shots, narration, music } = await fixture();
  const outPath = path.join(dir, 'with-music.mp4');
  await assembleVideo({ shots, narration, music, outPath });
  const s = checkSpec(await probeVideo(outPath), { expectedSec: 30 });
  assert.deepEqual(s.errors, []);
});