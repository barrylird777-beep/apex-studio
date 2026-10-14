import { setTimeout as delay } from 'node:timers/promises';

export const PRIORITY = Object.freeze({
  PAID_INFERENCE: 0,
  BACKGROUND_SWARM: 100
});

/**
 * Cooperative priority gate. A background job must implement a real checkpoint
 * and release its resource lease before paid work is allowed to start.
 * This deliberately does not use SIGSTOP/SIGCONT: those signals do not release
 * GPU allocations and cannot establish a safe render checkpoint.
 */
export function createPriorityPreemption({ logger = console } = {}) {
  const background = new Map();
  let paidActive = 0;
  let paidWaiting = 0;

  function registerBackground(jobId, child, { pause, resume } = {}) {
    if (!jobId || !child || typeof child.kill !== 'function') {
      throw new TypeError('jobId and a child process handle are required');
    }
    const entry = { child, pause, resume };
    background.set(String(jobId), entry);
    return () => {
      if (background.get(String(jobId)) === entry) background.delete(String(jobId));
    };
  }

  async function pauseBackground() {
    const paused = [];
    for (const [jobId, entry] of background) {
      const { child, pause } = entry;
      if (child.exitCode !== null || child.signalCode !== null) continue;
      if (typeof pause !== 'function') {
        throw new Error('Cannot admit paid inference: background job ' + jobId + ' has no cooperative checkpoint/release handler');
      }
      try {
        const checkpoint = await pause();
        if (!checkpoint || checkpoint.resourceReleased !== true) {
          throw new Error('checkpoint handler did not confirm resource release');
        }
        paused.push({ jobId, entry, checkpoint });
      } catch (error) {
        for (const item of paused.reverse()) {
          try { await item.entry.resume?.(item.checkpoint); }
          catch (resumeError) { logger.error?.('[APEX PRIORITY] checkpoint rollback failed', item.jobId, String(resumeError)); }
        }
        throw new Error('Cannot admit paid inference: background job ' + jobId + ' failed cooperative yield: ' + String(error?.message || error));
      }
    }
    return paused;
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
    let paused;
    try {
      paused = await pauseBackground();
      paidActive += 1;
    } finally {
      paidWaiting -= 1;
    }
    try { return await task(); }
    finally {
      paidActive -= 1;
      if (paidActive === 0) await resumeBackground(paused);
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
