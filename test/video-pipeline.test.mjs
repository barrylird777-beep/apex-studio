import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generationId, canonicalStringify } from '../src/video/identity.mjs';
import { validateHookPlan, validateTimeline, buildShotPrompt, STYLE_BLOCK } from '../src/video/hook.mjs';
import { buildFilterGraph, toSrt, buildFfmpegArgs, assembleVideo, probeVideo, checkSpec, zoompanExpr } from '../src/video/assemble.mjs';

const ffmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
const ffprobe = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const hasFfmpeg = ffmpeg && ffprobe;
if (!hasFfmpeg && process.env.CI) throw new Error('ffmpeg/ffprobe required in CI');
const SKIP = hasFfmpeg ? false : 'ffmpeg/ffprobe not installed (render test NOT run)';

const goodShot = (i, over = {}) => ({
  id: `s${i}`, kind: 'scene', durationSec: 3,
  motion: ['zoom_in', 'pan_left', 'zoom_out', 'pan_right'][i % 4],
  visual: `Visual ${i}`, narration: i === 0 ? 'He was never meant to survive the night.' : `Line ${i}.`,
  labels: ['dramatization'], sources: ['Gen 37:1-36'], image: `img${i}.png`, ...over,
});
const goodPlan = () => ({ ref: 'Gen 37', narrationStartSec: 0.5, shots: Array.from({ length: 10 }, (_, i) => goodShot(i)) });

test('generationId is deterministic and canonicalizes nested objects', () => {
  const a = { project: 'p', model: 'm', prompt: 'x', width: 1920, height: 1080, seed: 1, version: 'v1', params: { b: { d: 3, c: 2 }, a: 1 } };
  const b = { version: 'v1', seed: 1, height: 1080, width: 1920, prompt: 'x', model: 'm', project: 'p', params: { a: 1, b: { c: 2, d: 3 } } };
  assert.equal(generationId(a), generationId(b));
  assert.equal(canonicalStringify(a), canonicalStringify(b));
});

test('generationId changes when an output-affecting field changes', () => {
  const base = { project: 'p', model: 'm', prompt: 'x', width: 1920, height: 1080, seed: 1, version: 'v1', params: { cfg: 7 } };
  const id = generationId(base);
  for (const change of [{ seed: 2 }, { prompt: 'y' }, { width: 1280 }, { model: 'm2' }, { version: 'v2' }, { params: { cfg: 8 } }]) {
    assert.notEqual(generationId({ ...base, ...change }), id);
  }
});

test('generationId rejects missing required fields', () => {
  assert.throws(() => generationId({ project: 'p' }), /missing required field/);
});

test('valid 30s hook passes and enforces the retention rules', () => {
  const result = validateHookPlan(goodPlan());
  assert.deepEqual(result.errors, []);
  assert.equal(result.totalSec, 30);
});

test('hook rejects invalid duration, motion, title card, late narration, opener, and provenance', () => {
  const p = goodPlan(); p.shots = p.shots.slice(0, 5);
  assert.match(validateHookPlan(p).errors.join('|'), /total/);
  const long = goodPlan(); long.shots[1].durationSec = 6;
  assert.match(validateHookPlan(long).errors.join('|'), /duration 6s/);
  const nomo = goodPlan(); nomo.shots[2].motion = 'static';
  assert.match(validateHookPlan(nomo).errors.join('|'), /motion/);
  const title = goodPlan(); title.shots[0].kind = 'title';
  assert.match(validateHookPlan(title).errors.join('|'), /no logo\/title/);
  const late = goodPlan(); late.narrationStartSec = 2.5;
  assert.match(validateHookPlan(late).errors.join('|'), /narration must start/);
  const opener = goodPlan(); opener.shots[0].narration = 'In this video we explore Joseph.';
  assert.match(validateHookPlan(opener).errors.join('|'), /throat-clearing/);
  const nosrc = goodPlan(); nosrc.shots[3].sources = [];
  assert.match(validateHookPlan(nosrc).errors.join('|'), /sources/);
});

test('hook rejects a first line over 16 words', () => {
  const p = goodPlan();
  p.shots[0].narration = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
  assert.match(validateHookPlan(p).errors.join('|'), /20 words/);
});

test('timeline accounts for narration start offset', () => {
  assert.equal(validateTimeline(goodPlan().shots, 29, 0.5, 0.5).ok, true);
  assert.equal(validateTimeline(goodPlan().shots, 30, 0.5, 0.5).ok, false);
});

test('shot prompt contains shared style and character bible entry', () => {
  const prompt = buildShotPrompt({ shot: { visual: 'Joseph thrown into the pit.', characters: ['Joseph'] }, visualBible: { Joseph: 'young man, striped coat, dark curly hair' } });
  assert.ok(prompt.includes(STYLE_BLOCK));
  assert.ok(prompt.includes('Joseph: young man, striped coat, dark curly hair'));
});

test('xfade offsets are cumulative shot durations', () => {
  const shots = [3, 3, 3].map((durationSec, i) => goodShot(i, { durationSec }));
  const graph = buildFilterGraph(shots, { xfade: 0.4, narrationIndex: 3 });
  assert.match(graph, /offset=3\.000/);
  assert.match(graph, /offset=6\.000/);
  assert.match(graph, /\[vfinal\]/);
});

test('ducking and narration delay are built when requested', () => {
  const graph = buildFilterGraph([goodShot(0), goodShot(1)], { hasMusic: true, narrationIndex: 2, musicIndex: 3, narrationStartSec: 0.5 });
  assert.match(graph, /adelay=delays=500:all=1/);
  assert.match(graph, /sidechaincompress/);
  assert.match(graph, /amix=inputs=2/);
});

test('output args produce exact MP4 codec requirements and soft subtitles', () => {
  const args = buildFfmpegArgs({ shots: [goodShot(0), goodShot(1)], narration: 'n.m4a', music: null, srtPath: 's.srt', tmpOut: 'out.mp4.tmp', narrationStartSec: 0.5 });
  assert.ok(args.includes('6.000'));
  assert.ok(args.includes('libx264') && args.includes('aac') && args.includes('yuv420p'));
  assert.ok(args.includes('mov_text'));
  assert.equal(args.at(-1), 'out.mp4.tmp');
});

test('zoompan rejects unknown motion', () => {
  assert.throws(() => zoompanExpr('spin', 90), /unknown motion/);
});

test('SRT timings honor narration start and shot durations', () => {
  const srt = toSrt([
    goodShot(0, { durationSec: 3, narration: 'First.' }),
    goodShot(1, { durationSec: 2, narration: '' }),
    goodShot(2, { durationSec: 4, narration: 'Third.' }),
  ], 0.5);
  assert.match(srt, /00:00:00,500 --> 00:00:03,500\nFirst\./);
  assert.match(srt, /00:00:05,500 --> 00:00:09,500\nThird\./);
});

test('real render produces a valid 1920x1080 H.264/AAC ~30s MP4 with soft subtitles', { skip: SKIP, timeout: 300000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apex-video-'));
  const ff = (...args) => {
    const result = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const colors = ['0x1a0b2e', '0x3b0d0d', '0x0d2b3b', '0x2b2b0d', '0x0d3b1f', '0x3b0d2b', '0x222222', '0x0d0d3b', '0x3b240d', '0x240d3b'];
  const plan = goodPlan();
  plan.shots.forEach((shot, i) => {
    shot.image = path.join(dir, `img${i}.png`);
    ff('-f', 'lavfi', '-i', `color=c=${colors[i]}:s=1920x1080`, '-frames:v', '1', shot.image);
  });
  const narration = path.join(dir, 'narr.m4a');
  const music = path.join(dir, 'music.m4a');
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=28', '-c:a', 'aac', narration);
  ff('-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:a', 'aac', music);
  assert.equal(validateHookPlan(plan).ok, true);

  const out = path.join(dir, 'out', 'hook.mp4');
  const result = await assembleVideo({ shots: plan.shots, narration, music, outPath: out, narrationStartSec: plan.narrationStartSec });
  assert.ok(existsSync(out));
  assert.ok(existsSync(result.srtPath));
  assert.ok(readFileSync(result.srtPath, 'utf8').includes('He was never meant'));
  assert.deepEqual(readdirSync(path.join(dir, 'out')).filter((file) => file.endsWith('.tmp')), []);

  const probe = await probeVideo(out);
  assert.deepEqual(checkSpec(probe, { expectedSec: 30 }).errors, [], JSON.stringify(probe));
  assert.equal(probe.subtitleCodec, 'mov_text');
});

test('failed render cleans temp and generated subtitle files', { skip: SKIP }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apex-video-fail-'));
  const out = path.join(dir, 'out', 'bad.mp4');
  await assert.rejects(assembleVideo({
    shots: [goodShot(0, { image: path.join(dir, 'missing.png') }), goodShot(1, { image: path.join(dir, 'missing2.png') })],
    narration: path.join(dir, 'missing.m4a'),
    outPath: out,
  }));
  assert.equal(existsSync(out), false);
  assert.equal(existsSync(out.replace(/\.mp4$/i, '.srt')), false);
  assert.deepEqual(readdirSync(path.join(dir, 'out')).filter((file) => file.endsWith('.tmp')), []);
});
