import path from 'node:path';
import { contentId } from '../video/cache.mjs';
import { produceFromRef } from '../video/pipeline.mjs';
import { scoutPassage } from '../video/scout.mjs';
import { nonRetryable } from './overseer.mjs';

export const JOB_TYPES = { scout: 'video.scout', produce: 'video.produce' };

const slug = (ref) => `${String(ref).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${contentId({ ref }).slice(0, 8)}`;
const needRef = (p) => {
  if (typeof p?.ref !== 'string' || !p.ref.trim()) throw nonRetryable('payload.ref is required');
  return p.ref.trim();
};

export function createVideoHandlers({ gemini, ledger, outRoot, visualBible = {}, assemble, probe, log = () => {} }) {
  if (!gemini || !ledger || !outRoot) throw new Error('createVideoHandlers requires gemini, ledger, outRoot');
  return {
    [JOB_TYPES.scout]: async (payload) => {
      const ref = needRef(payload);
      const n = Number(payload.protocobs ?? 0);
      if (!Number.isInteger(n) || n < 0 || n > 5) throw nonRetryable('payload.protocobs must be an integer 0-5');
      const r = await scoutPassage({
        ref, outDir: path.join(outRoot, 'scout', slug(ref)), gemini, ledger, visualBible,
        protocobs: n, assemble, probe, log,
      });
      return {
        scoutingPath: r.scoutingPath,
        ratings: r.ratings.map(({ id, score, verdict }) => ({ id, score, verdict })),
        protocobs: r.protocobs,
      };
    },

    [JOB_TYPES.produce]: async (payload) => {
      const ref = needRef(payload);
      const r = await produceFromRef({
        ref, outDir: path.join(outRoot, 'produce', slug(ref)), gemini, ledger, visualBible,
        voice: payload.voice ?? 'Charon', assemble, probe, log,
      });
      if (!r.spec.ok) throw nonRetryable(`video failed its spec: ${JSON.stringify(r.spec).slice(0, 200)}`);
      return { videoPath: r.videoPath, planPath: r.planPath, runId: r.runId };
    },
  };
}

export const enqueueScout = (queue, { ref, protocobs = 0 }) =>
  queue.enqueue({ type: JOB_TYPES.scout, payload: { ref, protocobs }, dedupeKey: `scout:${ref}` });

export const enqueueProduce = (queue, { ref, voice }) =>
  queue.enqueue({ type: JOB_TYPES.produce, payload: { ref, ...(voice ? { voice } : {}) }, dedupeKey: `produce:${ref}` });
