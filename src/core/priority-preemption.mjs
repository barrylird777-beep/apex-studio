import { setTimeout as delay } from 'node:timers/promises';

export const PRIORITY = Object.freeze({
  PAID_INFERENCE: 0,
  BACKGROUND_SWARM: 100
});

/**
 * Coordinates paid requests with registered background child processes.
 * SIGSTOP pauses a process but does not guarantee GPU memory is released.
 * Callers must keep paid inference within the GPU's actual memory budget.
 */
export function createPriorityPreemption({ logger = console } = {}) {
  const background = new Map();
  let paidActive = 0;

  function registerBackground(jobId, child) {
    if (!jobId || !child || typeof child.kill !== 'function') {
      throw new TypeError('jobId and a child process handle are required');
    }
    background.set(String(jobId), child);
    return () => {
      if (background.get(String(jobId)) === child) background.delete(String(jobId));
    };
  }

  async function pauseBackground() {
    const paused = [];
    for (const [jobId, child] of background) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try {
        if (child.kill('SIGSTOP')) paused.push([jobId, child]);
      } catch (error) {
        logger.warn?.('[APEX PRIORITY] unable to pause background job', jobId, String(error));
      }
    }
    return paused;
  }

  function resumeBackground(paused) {
    for (const [jobId, child] of paused) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      try { child.kill('SIGCONT'); }
      catch (error) {
        logger.error?.('[APEX PRIORITY] unable to resume background job', jobId, String(error));
      }
    }
  }

  async function run(priority, task) {
    if (typeof task !== 'function') throw new TypeError('task callback is required');
    if (priority !== PRIORITY.PAID_INFERENCE && priority !== PRIORITY.BACKGROUND_SWARM) {
      throw new RangeError('unsupported execution priority');
    }
    if (priority === PRIORITY.BACKGROUND_SWARM) {
      while (paidActive > 0) await delay(25);
      return task();
    }
    paidActive += 1;
    const paused = await pauseBackground();
    try { return await task(); }
    finally {
      paidActive -= 1;
      if (paidActive === 0) resumeBackground(paused);
    }
  }

  return {
    run,
    registerBackground,
    unregisterBackground: jobId => background.delete(String(jobId)),
    status: () => ({ paidActive, backgroundChildren: background.size })
  };
}

export const apexPriorityPreemption = createPriorityPreemption();
