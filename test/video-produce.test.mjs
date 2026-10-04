import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createGemini } from '../src/video/gemini.mjs';
import { pcmToWav, parseWav, durationOfPcm } from '../src/video/wav.mjs';
import { generateHookPlan, buildHookPrompt, groundedErrors } from '../src/video/script.mjs';
import { fitDurations, buildNarrationTrack, produceHook } from '../src/video/produce.mjs';

const events = [{ id: 'e1', summary: 'Joseph is sold by his brothers.', sources: ['Gen 37:1-36'], label: 'scripture' }];
const MOTIONS = ['zoom_in', 'pan_left', 'zoom_out', 'pan_right'];
const validJson = (over = {}) => ({
  title: 'The Pit',
  shots: Array.from({ length: 10 }, (_, i) => ({
    durationSec: 3,
    motion: MOTIONS[i % 4],
    visual: `Visual ${i}`,
    characters: ['Joseph'],
    narration: i === 0 ? 'His brothers wanted him gone.' : `They sold Joseph before the journey began ${i}.`,
    labels: ['dramatization'],
    sources: ['Gen 37:1-36'],
  })),
  ...over,
});

function fakeGemini({ jsonResponses, ttsSec = 2 }) {
  const calls = { json: [], image: 0, speech: 0 };
  return {
    calls,
    models: { text: 't', image: 'img-model', tts: 'tts-model' },
    async generateJson(prompt) { calls.json.push(prompt); return structuredClone(jsonResponses.shift()); },
    async generateImage() { calls.image += 1; return { buffer: Buffer.from('png'), mimeType: 'image/png' }; },
    async generateSpeech() {
      calls.speech += 1;
      return { pcm: Buffer.alloc(Math.round(24000 * 2 * ttsSec), 1), sampleRate: 24000 };
    },
  };
}

test('pcmToWav/parseWav round-trip preserves PCM and sample rate', () => {
  const pcm = Buffer.alloc(48000, 7);
  const wav = pcmToWav(pcm, 24000);
  const parsed = parseWav(wav);
  assert.equal(parsed.sampleRate, 24000);
  assert.deepEqual(parsed.pcm, pcm);
  assert.equal(durationOfPcm(parsed.pcm, parsed.sampleRate), 1);
});

test('plan generation retries and feeds rejection reasons back into the prompt', async () => {
  const bad = validJson({ shots: validJson().shots.slice(0, 4) });
  const g = fakeGemini({ jsonResponses: [bad, validJson()] });
  const plan = await generateHookPlan({ gemini: g, ref: 'Gen 37', events });
  assert.equal(g.calls.json.length, 2);
  assert.match(g.calls.json[1], /Previous attempt rejected/);
  assert.match(g.calls.json[1], /total/);
  assert.equal(plan.shots.length, 10);
});

test('invalid source is rejected after retries', async () => {
  const bad = validJson();
  bad.shots[2].sources = ['Exod 99:99'];
  const g = fakeGemini({ jsonResponses: [bad, bad, bad] });
  await assert.rejects(generateHookPlan({ gemini: g, ref: 'Gen 37', events }), /not in the provided events/);
});

test('missing narration is rejected', async () => {
  const bad = validJson();
  bad.shots[4].narration = '';
  const g = fakeGemini({ jsonResponses: [bad, bad, bad] });
  await assert.rejects(generateHookPlan({ gemini: g, ref: 'Gen 37', events }), /narration is required/);
});

test('invalid events are refused before model calls', async () => {
  const g = fakeGemini({ jsonResponses: [] });
  await assert.rejects(generateHookPlan({ gemini: g, ref: 'x', events: [{ id: 'e', summary: 's' }] }), /need sources/);
  assert.equal(g.calls.json.length, 0);
});

test('prompt carries retention, grounding, and character rules', () => {
  const prompt = buildHookPrompt({ ref: 'Gen 37', events, visualBible: { Joseph: 'striped coat' } });
  assert.match(prompt, /Gen 37:1-36/);
  assert.match(prompt, /Joseph/);
  assert.match(prompt, /Never invent a Scripture reference/);
  assert.match(prompt, /Every shot MUST contain narration/);
});

test('fitDurations extends a shot to fit narration and rejects what cannot fit', () => {
  const clip = (sec) => Buffer.alloc(Math.round(24000 * 2 * sec), 1);
  const ok = fitDurations([{ id: 'a', durationSec: 3 }], [clip(3.4)], 24000);
  assert.equal(ok[0].durationSec, 3.6);
  assert.throws(() => fitDurations([{ id: 'b', durationSec: 3 }], [clip(4.5)], 24000), /over the 4s shot limit/);
});

test('narration track starts each clip at its shot start and pads with silence', () => {
  const rate = 24000;
  const shots = [{ durationSec: 3 }, { durationSec: 3 }];
  const clips = [Buffer.alloc(rate * 2, 1), Buffer.alloc(rate * 4, 2)];
  const track = buildNarrationTrack(shots, clips, rate);
  assert.equal(track.length, 6 * rate * 2);
  assert.equal(track[0], 1);
  assert.equal(track[rate * 2], 0);
  assert.equal(track[3 * rate * 2], 2);
  assert.equal(track[5 * rate * 2], 0);
});

test('produceHook caches TTS and images across reruns and writes an atomic plan', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apex-produce-'));
  let seen;
  const assemble = async (args) => {
    seen = args;
    writeFileSync(args.outPath, 'fake');
    return { outPath: args.outPath, srtPath: null };
  };
  const probe = async () => ({ width: 1920, height: 1080, vcodec: 'h264', acodec: 'aac', pixFmt: 'yuv420p', durationSec: 30 });

  const g1 = fakeGemini({ jsonResponses: [validJson()] });
  const r1 = await produceHook({ ref: 'Gen 37', events, outDir: dir, gemini: g1, assemble, probe });
  assert.equal(g1.calls.image, 10);
  assert.equal(g1.calls.speech, 10);
  assert.equal(r1.spec.ok, true);
  assert.equal(seen.shots.length, 10);
  assert.ok(seen.shots.every((shot) => shot.image && shot.durationSec >= 2 && shot.durationSec <= 4));

  const g2 = fakeGemini({ jsonResponses: [validJson()] });
  await produceHook({ ref: 'Gen 37', events, outDir: dir, gemini: g2, assemble, probe });
  assert.equal(g2.calls.image, 0);
  assert.equal(g2.calls.speech, 0);
  for (const sub of ['images', 'audio', '.']) {
    assert.deepEqual(readdirSync(path.join(dir, sub)).filter((file) => file.endsWith('.tmp')), []);
  }
});

const okBody = (parts, headers = new Headers()) => ({ ok: true, status: 200, headers, json: async () => ({ candidates: [{ content: { parts } }] }) });

test('Gemini client retries 429 and sends the key only in a header', async () => {
  let calls = 0;
  let captured;
  const g = createGemini({
    apiKey: 'SECRET',
    sleep: async () => {},
    fetchImpl: async (url, options) => {
      captured = { url, options };
      calls += 1;
      return calls === 1 ? { ok: false, status: 429, headers: new Headers(), text: async () => 'slow' } : okBody([{ text: '{"a":1}' }]);
    },
  });
  assert.deepEqual(await g.generateJson('x'), { a: 1 });
  assert.equal(calls, 2);
  assert.ok(!captured.url.includes('SECRET'));
  assert.equal(captured.options.headers['x-goog-api-key'], 'SECRET');
});

test('Gemini image and WAV TTS parsing', async () => {
  const image = Buffer.from('img');
  const fake = (parts) => createGemini({ apiKey: 'k', fetchImpl: async () => okBody(parts) });
  const g = fake([{ inlineData: { mimeType: 'image/jpeg', data: image.toString('base64') } }]);
  assert.deepEqual((await g.generateImage('p')).buffer, image);

  const pcm = Buffer.alloc(480, 1);
  const tts = fake([{ inlineData: { mimeType: 'audio/wav', data: pcmToWav(pcm, 16000).toString('base64') } }]);
  const speech = await tts.generateSpeech('t');
  assert.equal(speech.sampleRate, 16000);
  assert.deepEqual(speech.pcm, pcm);
});
