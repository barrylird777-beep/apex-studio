import test from 'node:test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import { generateEvents, validateEvents, chapterRange } from '../src/video/events.mjs';
import { produceFromRef } from '../src/video/pipeline.mjs';
import { createMemoryLedger, createFileLedger, createPostgresLedger } from '../src/video/ledger.mjs';

const eventsJson = (over = {}) => ({
  events: [
    { id: 'e1', summary: 'Joseph is favored by Jacob.', sources: ['Gen 37:3-4'], label: 'scripture', characters: ['Joseph'] },
    { id: 'e2', summary: 'His brothers sell him.', sources: ['Gen 37:28'], label: 'scripture', characters: ['Joseph'] },
  ],
  ...over,
});

const motions = ['zoom_in', 'pan_left', 'zoom_out', 'pan_right'];
const planJson = () => ({
  title: 'The Pit',
  shots: Array.from({ length: 10 }, (_, i) => ({
    durationSec: 3,
    motion: motions[i % motions.length],
    visual: `Visual ${i}`,
    characters: ['Joseph'],
    narration: i === 0 ? 'His brothers wanted him gone.' : `Line ${i}.`,
    labels: ['dramatization'],
    sources: ['Gen 37:3-4'],
  })),
});

function fakeGemini(jsonResponses) {
  const calls = { json: [], image: 0, speech: 0 };
  return {
    calls,
    models: { text: 't', image: 'img-model', tts: 'tts-model' },
    async generateJson(prompt) { calls.json.push(prompt); return structuredClone(jsonResponses.shift()); },
    async generateImage() { calls.image += 1; return { buffer: Buffer.from('png'), mimeType: 'image/png' }; },
    async generateSpeech() {
      calls.speech += 1;
      return { pcm: Buffer.alloc(48000, 1), sampleRate: 24000 };
    },
  };
}

const assemble = async (args) => {
  writeFileSync(args.outPath, 'fake');
  return { outPath: args.outPath, srtPath: null };
};
const probe = async () => ({
  width: 1920, height: 1080, vcodec: 'h264', acodec: 'aac', pixFmt: 'yuv420p', durationSec: 30,
});

test('chapterRange handles single chapters, ranges, and verse refs', () => {
  assert.deepEqual(chapterRange('Genesis 37'), { lo: 37, hi: 37 });
  assert.deepEqual(chapterRange('Genesis 37-39'), { lo: 37, hi: 39 });
  assert.deepEqual(chapterRange('Genesis 37:1-36'), { lo: 37, hi: 37 });
  assert.deepEqual(chapterRange('1 Samuel 17'), { lo: 17, hi: 17 });
});

test('validateEvents rejects wrong book, wrong chapter, bad label, missing sources', () => {
  const event = (over = {}) => [{ id: 'e1', summary: 's', sources: ['Gen 37:1'], label: 'scripture', ...over }];
  assert.deepEqual(validateEvents(event(), 'Genesis 37'), []);
  assert.match(validateEvents(event({ sources: ['Exod 37:1'] }), 'Genesis 37')[0], /outside Genesis/);
  assert.match(validateEvents(event({ sources: ['Gen 50:1'] }), 'Genesis 37')[0], /outside chapters/);
  assert.match(validateEvents(event({ label: 'myth' }), 'Genesis 37')[0], /label/);
  assert.match(validateEvents(event({ sources: [] }), 'Genesis 37')[0], /at least one source/);
});

test('generateEvents retries with validation reasons', async () => {
  const bad = eventsJson();
  bad.events[0].sources = ['Gen 99:1'];
  const gemini = fakeGemini([bad, eventsJson()]);
  const events = await generateEvents({ gemini, ref: 'Genesis 37' });
  assert.equal(events.length, 2);
  assert.match(gemini.calls.json[1], /Previous attempt rejected/);
  assert.match(gemini.calls.json[1], /outside chapters/);
});

test('generateEvents rejects an invalid ref before any model call', async () => {
  const gemini = fakeGemini([]);
  await assert.rejects(generateEvents({ gemini, ref: 'Genesis' }), /cannot find a chapter/);
  assert.equal(gemini.calls.json.length, 0);
});

test('PostgreSQL provenance ledger persists and reads a run when DATABASE_URL is available', async () => {
  if (!process.env.DATABASE_URL) return;
  const ledger = createPostgresLedger();
  const run = randomUUID();
  try {
    await ledger.record({ run, kind: 'test', status: 'ok', ref: 'Genesis 37', metadata: { source: 'video-test' } });
    const rows = await ledger.read(run);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].run, run);
    assert.equal(rows[0].metadata.source, 'video-test');
  } finally {
    await ledger.close();
  }
});

test('produceFromRef caches events, releases lock, writes provenance, and resumes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apex-pipe-'));
  const ledger = createMemoryLedger();
  const first = fakeGemini([eventsJson(), planJson()]);
  const result = await produceFromRef({ ref: 'Genesis 37', outDir: dir, gemini: first, ledger, assemble, probe });
  assert.equal(result.spec.ok, true);
  assert.ok(!readdirSync(dir).includes('.lock'));
  const rows = await ledger.read();
  assert.equal(rows.filter((row) => row.kind === 'image').length, 10);
  assert.ok(rows.every((row) => row.kind !== 'image' || /^[0-9a-f]{64}$/.test(row.sha256)));
  assert.ok(rows.some((row) => row.kind === 'run' && row.status === 'finished'));

  const second = fakeGemini([planJson()]);
  await produceFromRef({ ref: 'Genesis 37', outDir: dir, gemini: second, ledger, assemble, probe });
  assert.equal(second.calls.json.length, 1);
  assert.equal(second.calls.image, 0);
  assert.equal(second.calls.speech, 0);
});

test('production lock blocks a concurrent run and failed runs unlock', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apex-lock-'));
  let unlockDb = null;
  let db = null;
  if (process.env.DATABASE_URL) {
    db = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const client = await db.connect();
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [`apex-video:${path.resolve(dir)}`]);
    unlockDb = async () => {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`apex-video:${path.resolve(dir)}`]);
      client.release();
      await db.end();
    };
  } else {
    writeFileSync(path.join(dir, '.lock'), JSON.stringify({ pid: process.pid, ts: Date.now() }));
  }
  try {
    await assert.rejects(
      produceFromRef({ ref: 'Genesis 37', outDir: dir, gemini: fakeGemini([]), ledger: createMemoryLedger(), assemble, probe }),
      /in progress/,
    );
  } finally {
    if (unlockDb) await unlockDb();
  }

  const ledger = createFileLedger(path.join(dir, 'ledger.jsonl'));
  await assert.rejects(
    produceFromRef({
      ref: 'Genesis 37', outDir: dir, gemini: fakeGemini([{ events: [] }, { events: [] }, { events: [] }]),
      ledger, assemble, probe, lockStaleMs: 0,
    }),
    /events rejected/,
  );
  assert.ok(!readdirSync(dir).includes('.lock'));
  const rows = await ledger.read();
  assert.equal(rows.at(-1).status, 'failed');
});
