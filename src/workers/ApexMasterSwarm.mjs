import { claimNextWorkerTasks, completeWorkerTask, failWorkerTask, heartbeatWorkerTask, requeueExpiredWorkerTasks, releaseWorkerTasks } from "../core/mesh/durable-worker-store.mjs";
import { createEpisodeJobDispatcher } from "../core/mesh/episode-job-dispatcher.mjs";
import { runWithTrace, log } from "../core/resilience/load-shedder.mjs";

export class ApexMasterSwarm {
  constructor(pool, {
    maxConcurrency = 16,
    pollIntervalMs = 1000,
    leaseMs = 45000,
    handlers = {}
  } = {}) {
    if (!pool) throw new TypeError("ApexMasterSwarm requires PostgreSQL");
    this.pool = pool;
    this.maxConcurrency = Math.max(1, Math.min(100, Number(maxConcurrency) || 16));
    this.pollIntervalMs = Math.max(250, Number(pollIntervalMs) || 1000);
    this.leaseMs = Math.max(15000, Number(leaseMs) || 45000);
    this.handlers = new Map(Object.entries(handlers));
    this.episodeDispatcher = createEpisodeJobDispatcher({ pool });
    this.isRunning = false;
    this.inFlight = new Map();
    this.claimed = new Map();
    this._loops = [];
  }

  async ignite() {
    if (this.isRunning) return;
    this.isRunning = true;
    log("info", "Apex master swarm online", { concurrency: this.maxConcurrency });

    this._loops = Array.from({ length: this.maxConcurrency }, (_, index) =>
      this.runWorkerLoop(`master-${index + 1}`)
    );

    await Promise.all(this._loops);
  }

  async dispatch(task) {
    const role = String(task?.role || task?.task || "");

    // Canonical episode DAG stays on the existing dispatcher.
    const episodeResult = await this.episodeDispatcher(task);
    if (episodeResult !== null) return episodeResult;

    const handler = this.handlers.get(role);
    if (!handler || typeof handler.process !== "function") {
      throw new Error(`No handler registered for durable task role: ${role}`);
    }

    return handler.process(task.payload || {});
  }

  async runWorkerLoop(workerId) {
    let emptyPolls = 0;

    while (this.isRunning) {
      try {
        await requeueExpiredWorkerTasks(100);

        const available = this.maxConcurrency - this.inFlight.size;
        if (available <= 0) {
          await this.sleep(100);
          continue;
        }

        const task = await claimNextWorkerTasks(Math.min(1, available), this.leaseMs).then(rows => rows[0] || null);
        if (!task) {
          emptyPolls = Math.min(emptyPolls + 1, 6);
          const delay = Math.min(5000, this.pollIntervalMs * (2 ** emptyPolls));
          await this.sleep(delay + Math.floor(Math.random() * Math.max(25, delay * 0.2)));
          continue;
        }

        emptyPolls = 0;
        this.claimed.set(task.id, task);
        this.inFlight.set(task.id, task);

        await this.executeTask(task, workerId);
      } catch (error) {
        log("error", "Master swarm worker loop fault", {
          worker_id: workerId,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  async executeTask(task, workerId) {
    const heartbeat = setInterval(() => {
      void heartbeatWorkerTask(task.id, this.leaseMs, task.lease_token).catch(error => {
        log("warn", "Worker heartbeat failed", {
          worker_id: workerId,
          task_id: task.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
    }, Math.max(5000, Math.floor(this.leaseMs / 3)));
    heartbeat.unref?.();

    try {
      const result = await runWithTrace(
        {
          job_id: String(task.id),
          worker_id: workerId,
          episode_id: String(task.payload?.episodeId || "")
        },
        () => this.dispatch(task)
      );

      // Deferred tasks have already released their lease through the canonical store.
      if (result?.deferred) return;

      const completed = await completeWorkerTask(task.id, result, task.lease_token);
      if (!completed) throw new Error("Task completion was fenced out");

      log("info", "Master swarm task completed", {
        worker_id: workerId,
        task_id: task.id,
        role: task.role
      });
    } catch (error) {
      await failWorkerTask(task.id, error, task.lease_token).catch(failure => {
        log("error", "Failed to persist worker failure", {
          task_id: task.id,
          error: failure instanceof Error ? failure.message : String(failure)
        });
      });
      log("error", "Master swarm task failed", {
        worker_id: workerId,
        task_id: task.id,
        role: task.role,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      clearInterval(heartbeat);
      this.inFlight.delete(task.id);
      this.claimed.delete(task.id);
    }
  }

  async shutdown() {
    if (!this.isRunning) return;
    this.isRunning = false;
    const deadline = Date.now() + 30000;

    while (this.inFlight.size && Date.now() < deadline) {
      await this.sleep(100);
    }

    const unstarted = [...this.claimed.values()].filter(task => !this.inFlight.has(task.id));
    if (unstarted.length) {
      await releaseWorkerTasks(
        unstarted.map(task => task.id),
        unstarted.map(task => task.lease_token)
      );
    }

    log("info", "Apex master swarm drained", {});
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
