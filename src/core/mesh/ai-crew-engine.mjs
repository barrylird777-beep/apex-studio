export function createAiCrewEngine({
  concurrency = 64,
  dispatch,
  assignments = []
}) {
  const limit = Math.max(1, Number(concurrency) || 1);
  const queue = [];
  const jobs = new Map();
  let active = 0;
  let sequence = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const normalizedAssignments = Array.isArray(assignments) && assignments.length
    ? assignments.map((assignment, index) => ({
        role: String(assignment?.role || `crew-${index + 1}`),
        provider: String(assignment?.provider || '').trim(),
        model: assignment?.model ? String(assignment.model).trim() : undefined,
        task: String(assignment?.task || 'Inspect Apex Studio for one concrete root defect or improvement opportunity. Return a concise, evidence-based finding.')
      }))
    : [{
        role: 'general',
        provider: '',
        model: undefined,
        task: 'Inspect Apex Studio for one concrete root defect or improvement opportunity. Return a concise, evidence-based finding.'
      }];

  const run = async job => {
    const maxAttempts = Math.max(1, Math.min(5, Number(job.maxAttempts) || 3));

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      job.attempts = attempt;
      job.lastAttemptAt = new Date().toISOString();

      try {
        return await dispatch(job.payload);
      } catch (error) {
        job.lastError = error?.message || String(error);
        if (attempt >= maxAttempts) throw error;
        const delay = Math.min(10000, 250 * (2 ** (attempt - 1)));
        job.nextRetryAt = new Date(Date.now() + delay).toISOString();
        await sleep(delay);
      }
    }

    throw new Error('AI crew exhausted retry attempts');
  };

  const pump = () => {
    while (active < limit && queue.length) {
      const job = queue.shift();
      active += 1;
      job.status = 'running';
      job.startedAt = new Date().toISOString();

      Promise.resolve()
        .then(() => run(job))
        .then(result => {
          job.status = 'completed';
          job.result = result;
          job.completedAt = new Date().toISOString();
          job.nextRetryAt = null;
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

  const enqueue = ({
    role = 'general',
    task = '',
    context = {},
    provider = '',
    model,
    maxAttempts = 3
  } = {}) => {
    if (typeof dispatch !== 'function') throw new Error('AI crew dispatch is required');

    const id = 'crew_' + Date.now().toString(36) + '_' + (++sequence);
    const normalizedProvider = String(provider || '').trim();
    const normalizedTask = String(task || '').trim();
    if (!normalizedTask) throw new Error('AI crew task is required');

    const job = {
      id,
      role: String(role),
      task: normalizedTask,
      provider: normalizedProvider || null,
      model: model ? String(model) : null,
      maxAttempts: Math.max(1, Math.min(5, Number(maxAttempts) || 3)),
      context,
      status: 'queued',
      attempts: 0,
      createdAt: new Date().toISOString(),
      lastError: null,
      nextRetryAt: null,
      payload: {
        type: 'inference',
        provider: normalizedProvider || undefined,
        model: model ? String(model) : undefined,
        prompt: normalizedTask,
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
      const assignment = normalizedAssignments[i % normalizedAssignments.length];
      created.push(enqueue({
        role: assignment.role,
        provider: assignment.provider,
        model: assignment.model,
        task: assignment.task,
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
        running: all.filter(job => job.status === 'running').length,
        assignments: normalizedAssignments,
        jobs: all.slice(-100).map(({ payload, context, ...job }) => job)
      };
    }
  };
}
