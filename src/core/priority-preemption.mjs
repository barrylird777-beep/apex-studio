import { setTimeout as delay } from 'node:timers/promises';

export const PRIORITY = Object.freeze({
  PAID_INFERENCE: 0,
  BACKGROUND_SWARM: 100
});

export function createPriorityPreemption({
  logger = console,
  checkpointTimeoutMs = 15000
} = {}) {
  const background = new Map();
  let paidActive = 0;
  let paidWaiting = 0;
  let paidTail = Promise.resolve();
  let heldPaused = null;

  function registerBackground(jobId, child, { pause, resume } = {}) {
    if (!jobId || !child || typeof child.kill !== 'function') {
      throw new TypeError('jobId and a child process handle are required');
    }
    if ((typeof pause === 'function') !== (typeof resume === 'function')) {
      throw new TypeError('pause and resume handlers must be supplied together');
    }
    const entry = { child, pause, resume };
    background.set(String(jobId), entry);
    return () => {
      if (background.get(String(jobId)) === entry) background.delete(String(jobId));
    };
  }

  async function timedPause(jobId, entry) {
    if (typeof entry.pause !== 'function') {
      throw new Error('Cannot admit paid inference: background job ' + jobId + ' has no cooperative checkpoint/release handler');
    }
    let timer;
    let timedOut = false;
    const operation = Promise.resolve().then(() => entry.pause());
    try {
      const checkpoint = await Promise.race([
        operation,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error('checkpoint timed out after ' + checkpointTimeoutMs + 'ms'));
          }, checkpointTimeoutMs);
        })
      ]);
      if (!checkpoint || checkpoint.resourceReleased !== true) {
        throw new Error('checkpoint handler did not confirm resource release');
      }
      return checkpoint;
    } catch (error) {
      if (timedOut) {
        // A late checkpoint must not strand a render paused after admission failed.
        operation.then(async checkpoint => {
          if (checkpoint?.resourceReleased === true) {
            try { await entry.resume?.(checkpoint); }
            catch (resumeError) { logger.error?.('[APEX PRIORITY] late checkpoint resume failed', jobId, String(resumeError)); }
          }
        }).catch(lateError => logger.warn?.('[APEX PRIORITY] late checkpoint failed', jobId, String(lateError)));
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function pauseBackground(skipEntries = new Set()) {
    const paused = [];
    try {
      for (const [jobId, entry] of background) {
        if (skipEntries.has(entry)) continue;
        const child = entry.child;
        if (child.exitCode !== null || child.signalCode !== null) continue;
        const checkpoint = await timedPause(jobId, entry);
        paused.push({ jobId, entry, checkpoint });
      }
      return paused;
    } catch (error) {
      for (const item of paused.reverse()) {
        try {
          if (typeof item.entry.resume !== 'function') throw new Error('resume handler is missing');
          await item.entry.resume(item.checkpoint);
        } catch (resumeError) {
          logger.error?.('[APEX PRIORITY] checkpoint rollback failed', item.jobId, String(resumeError));
        }
      }
      throw new Error('Cannot admit paid inference: ' + String(error?.message || error));
    }
  }

  async function resumeBackground(paused) {
    for (const { jobId, entry, checkpoint } of paused) {
      try {
        if (typeof entry.resume !== 'function') throw new Error('resume handler is missing');
        await entry.resume(checkpoint);
      } catch (error) {
        logger.error?.('[APEX PRIORITY] checkpoint resume failed', jobId, String(error));
      }
    }
  }

  async function run(priority, task) {
    if (typeof task !== 'function') throw new TypeError('task callback is required');
    if (priority !== PRIORITY.PAID_INFERENCE && priority !== PRIORITY.BACKGROUND_SWARM) {
      throw new RangeError('unsupported execution priority');
    }
    if (priority === PRIORITY.BACKGROUND_SWARM) {
      while (paidActive > 0 || paidWaiting > 0) await delay(25);
      return task();
    }

    paidWaiting += 1;
    let release;
    const previous = paidTail;
    paidTail = new Promise(resolve => { release = resolve; });
    await previous;
    let paused = [];
    try {
      // Keep the background lane checkpointed across an already-queued paid task.
      // This avoids resuming a swarm job for a few milliseconds between paid requests.
      if (heldPaused) {
        const alreadyPaused = new Set(heldPaused.map(item => item.entry));
        paused = [...heldPaused, ...await pauseBackground(alreadyPaused)];
      } else {
        paused = await pauseBackground();
      }
      heldPaused = null;
      paidActive = 1;
      return await task();
    } finally {
      paidActive = 0;
      paidWaiting -= 1;
      try {
        if (paidWaiting > 0) heldPaused = paused;
        else await resumeBackground(paused);
      } finally { release(); }
    }
  }

  return {
    run,
    registerBackground,
    unregisterBackground: jobId => background.delete(String(jobId)),
    status: () => ({ paidActive, paidWaiting, backgroundChildren: background.size })
  };
}

export const apexPriorityPreemption = createPriorityPreemption();
