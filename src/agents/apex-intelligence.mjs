import { enqueueWorkerTask } from "../core/mesh/durable-worker-store.mjs";
import crypto from "node:crypto";

const DEFAULT_SPECIALISTS = Object.freeze([
  { name: "Biblical Historian", capabilities: ["research", "history", "provenance", "scripture"] },
  { name: "Textual Traditions Analyst", capabilities: ["scripture", "canon", "translation", "manuscript"] },
  { name: "Visual Director", capabilities: ["visual", "cinematic", "camera", "lighting", "continuity"] },
  { name: "Audio Director", capabilities: ["audio", "music", "sound", "voice", "mix"] },
  { name: "Production Engineer", capabilities: ["production", "dependencies", "release", "recovery"] },
  { name: "Archivist", capabilities: ["memory", "lineage", "provenance", "knowledge"] },
  { name: "Editor Core Engineer", capabilities: ["editor", "timeline", "keyframes", "transitions"] },
  { name: "Video Engine Engineer", capabilities: ["video", "render", "encoding", "compositing"] },
  { name: "Caption Engineer", capabilities: ["captions", "subtitles", "accessibility", "timing"] },
  { name: "QA Engineer", capabilities: ["qa", "validation", "testing", "integrity"] }
]);

const STOP = new Set(["the", "and", "for", "with", "from", "that", "this", "into", "make", "need", "want"]);

function words(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(word => word && !STOP.has(word));
}

function fingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeResult(result) {
  if (result == null) return { status: "blocked", reason: "No execution result was returned." };
  if (typeof result === "string") return { status: "progress", output: result };
  return { status: "progress", ...result };
}

export class ApexIntelligence {
  constructor(options = {}) {
    this.specialists = [...(options.specialists ?? DEFAULT_SPECIALISTS)];
    this.memory = options.memory ?? null;
    this.providers = options.providers ?? null;
    this.events = options.events ?? null;
    this.executor = options.executor;
    this.verifier = options.verifier;
    this.verifiers = Array.isArray(options.verifiers)
      ? options.verifiers.filter(fn => typeof fn === "function")
      : [];
    if (typeof this.verifier === "function") this.verifiers.unshift(this.verifier);
    this.recoverer = options.recoverer;
    this.parallelExecutor = options.parallelExecutor;
    this.persistence = options.persistence ?? null;
    this.durableQueue = options.durableQueue ?? enqueueWorkerTask;
    if (typeof this.executor !== "function") {
      throw new TypeError("ApexIntelligence requires an executor.");
    }
    if (!this.verifiers.length) {
      throw new TypeError("ApexIntelligence requires at least one verifier.");
    }
  }

  selectSpecialists(goal, context = {}, limit = 3) {
    const goalTokens = new Set(words(goal));
    const contextTokens = new Set([
      ...words(context.focus),
      ...words(context.type),
      ...(Array.isArray(context.requiredCapabilities) ? context.requiredCapabilities.flatMap(words) : [])
    ]);
    return this.specialists
      .map((specialist, index) => {
        const capabilities = new Set(specialist.capabilities.flatMap(words));
        const exact = [...capabilities].filter(capability => goalTokens.has(capability)).length;
        const contextual = [...capabilities].filter(capability => contextTokens.has(capability)).length;
        const score = exact * 4 + contextual * 2 + Math.min(capabilities.size, 8) * 0.01;
        return { specialist, score, index };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, Math.max(1, limit))
      .map(({ specialist, score }) => ({ ...specialist, score }));
  }

  async recall(goal, context = {}) {
    if (!this.memory) return [];
    if (typeof this.memory.search === "function") {
      return this.memory.search(goal, { projectId: context.projectId, limit: context.memoryLimit ?? 20 });
    }
    if (typeof this.memory.retrieve === "function") {
      return this.memory.retrieve(goal, context);
    }
    return [];
  }

  async runParallel(tasks = [], context = {}) {
    if (!tasks.length) return { status: "progress", outputs: [] };
    if (typeof this.parallelExecutor === "function") {
      return normalizeResult(await this.parallelExecutor(tasks, context));
    }
    const results = await Promise.allSettled(tasks.map(task => this.executor({
      ...task, phase: task.phase ?? "execute", context, parallel: true
    })));
    return {
      status: results.some(result => result.status === "fulfilled") ? "progress" : "blocked",
      outputs: results.map((result, index) => ({
        index,
        status: result.status,
        output: result.status === "fulfilled" ? normalizeResult(result.value) : null,
        error: result.status === "rejected" ? String(result.reason?.message ?? result.reason) : null
      }))
    };
  }

  async verifyConsensus(input) {
    const results = await Promise.allSettled(
      this.verifiers.map(verifier => verifier(input))
    );
    const reviews = results.map((result, index) => {
      if (result.status === "rejected") {
        return { verifier: index, verified: false, status: "error", error: String(result.reason?.message ?? result.reason) };
      }
      const value = normalizeResult(result.value);
      return { verifier: index, ...value, verified: value.verified === true || value.status === "verified" };
    });
    const usable = reviews.filter(review => review.status !== "error");
    const required = Math.max(1, Math.min(
      usable.length || this.verifiers.length,
      Number(input.context?.verificationQuorum ?? Math.ceil(this.verifiers.length / 2))
    ));
    const approvals = usable.filter(review => review.verified);
    return {
      verified: approvals.length >= required,
      status: approvals.length >= required ? "verified" : "retry",
      quorum: { required, approvals: approvals.length, reviewers: usable.length },
      reviews,
      evidence: approvals.flatMap(review => Array.isArray(review.evidence) ? review.evidence : [])
    };
  }

  async writeMemory(entry, context = {}) {
    if (!this.memory) return null;
    const value = {
      ...entry,
      projectId: context.projectId ?? entry.projectId ?? null,
      importance: Number(entry.importance ?? 0.75),
      createdAt: new Date().toISOString()
    };
    if (typeof this.memory.remember === "function") return this.memory.remember(value);
    if (typeof this.memory.write === "function") return this.memory.write(value);
    return null;
  }

  async enqueueDurable(goal, context = {}) {
    return this.durableQueue({
      workerId: `apex-intelligence-${process.pid}`,
      role: "intelligence",
      task: "apex.intelligence.run",
      payload: { goal, context },
      maxAttempts: Number(context.maxAttempts ?? 8),
      dedupeKey: context.dedupeKey ?? `apex-intelligence:${crypto.createHash("sha256").update(JSON.stringify({ goal, context })).digest("hex")}`,
      traceId: context.traceId ?? null,
      priority: Number(context.priority ?? 1000)
    });
  }

  async persist(value) {
    if (typeof this.persistence !== "function") return null;
    return this.persistence(value);
  }

  buildPlan(goal, context, specialists, memories) {
    return {
      id: crypto.randomUUID(),
      goal,
      context,
      specialists: specialists.map(specialist => specialist.name),
      memories,
      stages: ["diagnose", "work-around", "decompose", "parallelize", "execute", "verify"],
      status: "ready",
      createdAt: new Date().toISOString()
    };
  }

  async run(goal, context = {}) {
    const startedAt = new Date().toISOString();
    const specialists = this.selectSpecialists(goal, context, context.specialistLimit ?? 3);
    const memories = await this.recall(goal, context);
    const plan = this.buildPlan(goal, context, specialists, memories);
    const history = [];
    const seen = new Set();
    const evidence = [];

    await this.persist({ type: "started", plan }).catch(() => {});
    this.events?.emit?.("apex.intelligence.started", { plan });

    let state = { status: "diagnose", plan, specialists, memories, context };

    while (true) {
      const stateKey = fingerprint({
        status: state.status,
        plan: state.plan?.id,
        output: state.output,
        blockers: state.blockers,
        recovery: state.recovery
      });

      if (seen.has(stateKey)) {
        const blocked = {
          status: "blocked",
          reason: "Execution entered a repeated state without producing new evidence.",
          plan,
          history,
          startedAt,
          completedAt: new Date().toISOString()
        };
        this.events?.emit?.("apex.intelligence.blocked", blocked);
        return blocked;
      }
      seen.add(stateKey);
      history.push({ status: state.status, at: new Date().toISOString() });

      if (state.status === "diagnose") {
        state = normalizeResult(await this.executor({
          phase: "diagnose",
          goal,
          plan,
          specialists,
          memories,
          context
        }));
        if (Array.isArray(state.evidence)) evidence.push(...state.evidence);
        continue;
      }

      if (state.status === "work-around" || state.status === "decompose") {
        state = normalizeResult(await this.executor({
          phase: state.status,
          goal,
          plan,
          specialists,
          memories,
          previous: state,
          context,
          providerRegistry: this.providers
        }));
        if (Array.isArray(state.evidence)) evidence.push(...state.evidence);
        continue;
      }

      if (state.status === "parallelize") {
        state = normalizeResult(await this.runParallel(
          Array.isArray(state.tasks) ? state.tasks : [],
          context
        ));
        if (Array.isArray(state.evidence)) evidence.push(...state.evidence);
        continue;
      }

      if (state.status === "execute" || state.status === "progress" || state.status === "retry") {
        state = normalizeResult(await this.executor({
          phase: "execute",
          goal,
          plan,
          specialists,
          memories,
          previous: state,
          context,
          providerRegistry: this.providers
        }));
        if (Array.isArray(state.evidence)) evidence.push(...state.evidence);
        continue;
      }

      if (state.status === "verify") {
        const verification = await this.verifyConsensus({
          goal,
          plan,
          specialists,
          memories,
          output: state.output,
          evidence: [...evidence, ...(state.evidence ?? [])],
          context
        });
        evidence.push(...(verification.evidence ?? []));

        if (verification.verified) {
          const result = {
            status: "complete",
            verified: true,
            goal,
            output: state.output,
            evidence,
            quorum: verification.quorum,
            reviews: verification.reviews,
            specialists,
            history,
            startedAt,
            completedAt: new Date().toISOString()
          };
          await this.writeMemory({
            type: "intelligence.success",
            content: typeof state.output === "string" ? state.output : JSON.stringify(state.output),
            planId: plan.id,
            evidence,
            importance: 0.85
          }, context);
          await this.persist(result);
          this.events?.emit?.("apex.intelligence.completed", result);
          return result;
        }

        state = { status: "retry", output: state.output, evidence, verification };
        continue;
      }

      if (state.status === "blocked") {
        if (typeof this.recoverer !== "function") {
          const result = {
            status: "blocked",
            verified: false,
            goal,
            reason: state.reason ?? "Execution is blocked and no recovery path is registered.",
            history,
            startedAt,
            completedAt: new Date().toISOString()
          };
          await this.writeMemory({ type: "intelligence.failure", content: result.reason, planId: plan.id, importance: 0.6 }, context);
          await this.persist(result);
          this.events?.emit?.("apex.intelligence.blocked", result);
          return result;
        }
        state = normalizeResult(await this.recoverer({
          goal,
          plan,
          specialists,
          memories,
          blocked: state,
          context
        }));
        continue;
      }

      state = normalizeResult(await this.executor({
        phase: "route",
        goal,
        plan,
        specialists,
        memories,
        previous: state,
        context
      }));
    }
  }
}

export { DEFAULT_SPECIALISTS };
