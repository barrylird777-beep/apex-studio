export function createAiCrewEngine({ concurrency = 64, dispatch }) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const queue = [];
  const jobs = new Map();
  let active = 0;
  let sequence = 0;

  const pump = () => {
    while (active < limit && queue.length) {
      const job = queue.shift();
      active += 1;
      job.status = 'running';
      job.startedAt = new Date().toISOString();

      Promise.resolve()
        .then(() => dispatch(job.payload))
        .then(result => {
          job.status = 'completed';
          job.result = result;
          job.completedAt = new Date().toISOString();
        })
        .catch(error => {
          job.status = 'failed';
          job.error = error?.message || String(error);
          job.completedAt = new Date().toISOString();
        })
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  const enqueue = ({ role = 'general', task = '', context = {} } = {}) => {
    if (typeof dispatch !== 'function') throw new Error('AI crew dispatch is required');
    const prompt = String(task).trim();
    if (!prompt) throw new Error('AI crew task is required');

    const id = 'crew_' + Date.now().toString(36) + '_' + (++sequence);
    const job = {
      id,
      role: String(role),
      task: prompt,
      context,
      status: 'queued',
      createdAt: new Date().toISOString(),
      payload: {
        type: 'inference',
        prompt,
        system: typeof context === 'string' ? context : undefined
      }
    };
    jobs.set(id, job);
    queue.push(job);
    pump();
    return job;
  };

  const burst = (count = 32, context = {}) => {
    const total = Math.max(0, Math.min(limit * 4, Number(count) || 0));
    const created = [];
    for (let i = 0; i < total; i += 1) {
      created.push(enqueue({
        role: 'general',
        task: 'Inspect Apex Studio for one concrete root defect or improvement opportunity. Return a concise, evidence-based finding.',
        context
      }));
    }
    return created;
  };

  return {
    enqueue,
    burst,
    status() {
      const all = [...jobs.values()];
      return {
        concurrency: limit,
        active,
        queued: queue.length,
        total: all.length,
        completed: all.filter(job => job.status === 'completed').length,
        failed: all.filter(job => job.status === 'failed').length,
        jobs: all.slice(-100).map(({ payload, result, ...job }) => job)
      };
    }
  };
}
