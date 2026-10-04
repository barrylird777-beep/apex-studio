import { createHash, randomUUID } from 'node:crypto';
import { readFile, open, rm, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { generateEvents, EVENTS_VERSION } from './events.mjs';
import { produceHook } from './produce.mjs';
import { contentId, atomicWrite, exists } from './cache.mjs';
import { createFileLedger } from './ledger.mjs';

const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');

async function acquireLock(dir, staleMs) {
  if (String(process.env.DATABASE_URL || '').trim()) {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const client = await pool.connect();
    let handedOff = false;
    try {
      const locked = await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
        [`apex-video:${dir}`],
      );
      if (!locked.rows[0]?.locked) throw new Error(`another production run is in progress (${dir})`);
      let released = false;
      handedOff = true;
      return async () => {
        if (released) return;
        released = true;
        try {
          await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`apex-video:${dir}`]);
        } finally {
          client.release();
          await pool.end();
        }
      };
    } catch (error) {
      if (!handedOff) client.release();
      await pool.end().catch(() => {});
      throw error;
    }
  }
  const file = path.join(dir, '.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(file, 'wx');
      await handle.writeFile(JSON.stringify({ pid: process.pid, ts: Date.now() }));
      await handle.close();
      return async () => { await rm(file, { force: true }); };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = await stat(file).catch(() => null);
      if (current && Date.now() - current.mtimeMs < staleMs) {
        throw new Error(`another production run is in progress (${file})`);
      }
      await rm(file, { force: true });
    }
  }
  throw new Error('could not acquire production lock');
}

async function loadOrMakeEvents({ dir, ref, gemini, log }) {
  const key = contentId({ kind: 'events', ref, model: gemini.models.text, version: EVENTS_VERSION });
  const file = path.join(dir, 'events.json');
  if (await exists(file)) {
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      if (saved.key === key && Array.isArray(saved.events)) {
        log('events: reusing cached events');
        return { events: saved.events, file, key, cached: true };
      }
    } catch {
      log('events: cached file is invalid; regenerating');
    }
  }
  log('events: generating from Scripture reference');
  const events = await generateEvents({ gemini, ref });
  await atomicWrite(file, JSON.stringify({ key, ref, events }, null, 2));
  return { events, file, key, cached: false };
}

export async function produceFromRef({
  ref, outDir, gemini, visualBible = {}, music = null, voice = 'Charon',
  ledger = createFileLedger(path.join(path.resolve(outDir), 'ledger.jsonl')),
  assemble, probe, log = () => {}, lockStaleMs = 30 * 60 * 1000,
}) {
  if (!ref || typeof ref !== 'string') throw new Error('produceFromRef: ref is required');
  if (!outDir || typeof outDir !== 'string') throw new Error('produceFromRef: outDir is required');
  if (!gemini?.models) throw new Error('produceFromRef: invalid Gemini/provider client');

  const dir = path.resolve(outDir);
  await mkdir(dir, { recursive: true });
  const release = await acquireLock(dir, lockStaleMs);
  const run = randomUUID();

  try {
    await ledger.record({ run, kind: 'run', status: 'started', ref });
    const events = await loadOrMakeEvents({ dir, ref, gemini, log });
    await ledger.record({
      run, kind: 'events', status: events.cached ? 'cached' : 'generated',
      id: events.key, path: events.file, count: events.events.length, model: gemini.models.text,
    });

    const options = {};
    if (assemble) options.assemble = assemble;
    if (probe) options.probe = probe;
    const result = await produceHook({
      ref, events: events.events, visualBible, outDir: dir, gemini, music, voice, log, ...options,
    });

    const plan = JSON.parse(await readFile(result.planPath, 'utf8'));
    for (const shot of plan.shots) {
      await ledger.record({
        run, kind: 'image', status: 'ok', id: shot.imageId, shot: shot.id, path: shot.image,
        sha256: await sha256(shot.image), model: gemini.models.image,
        labels: shot.labels, sources: shot.sources,
      });
    }
    await ledger.record({
      run, kind: 'narration', status: 'ok', path: plan.narration,
      sha256: await sha256(plan.narration), model: gemini.models.tts, voice,
    });
    await ledger.record({
      run, kind: 'video', status: result.spec.ok ? 'ok' : 'spec_failed',
      path: result.videoPath, sha256: await sha256(result.videoPath), spec: result.spec,
    });
    await ledger.record({ run, kind: 'run', status: 'finished', ref });
    return { ...result, eventsPath: events.file, runId: run };
  } catch (error) {
    await ledger.record({
      run, kind: 'run', status: 'failed', ref,
      error: String(error.message ?? error).slice(0, 500),
    }).catch(() => {});
    throw error;
  } finally {
    await release();
  }
}
