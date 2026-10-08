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
    this.recoverer = options.recoverer;
    if (typeof this.executor !== "function") {
      throw new TypeError("ApexIntelligence requires an executor.");
    }
    if (typeof this.verifier !== "function") {
      throw new TypeError("ApexIntelligence requires a verifier.");
    }
  }

  selectSpecialists(goal, context = {}, limit = 3) {
    const tokens = new Set([...words(goal), ...words(context.focus), ...words(context.type)]);
    return this.specialists
      .map(specialist => {
        const score = specialist.capabilities.reduce(
          (total, capability) => total + (tokens.has(capability) ? 1 : 0),
          0
        );
        return { specialist, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit))
      .map(({ specialist }) => specialist);
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
        continue;
      }

      if (state.status === "work-around" || state.status === "decompose" || state.status === "parallelize") {
        state = normalizeResult(await this.executor({
          phase: state.status,
          goal,
          plan,
          specialists,
          memories,
          previous: state,
          context
        }));
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
        continue;
      }

      if (state.status === "verify") {
        const verification = normalizeResult(await this.verifier({
          goal,
          plan,
          specialists,
          memories,
          output: state.output,
          evidence: state.evidence,
          context
        }));

        if (verification.status === "verified" || verification.verified === true) {
          const result = {
            status: "complete",
            verified: true,
            goal,
            output: state.output,
            evidence: verification.evidence ?? state.evidence ?? [],
            specialists,
            history,
            startedAt,
            completedAt: new Date().toISOString()
          };
          this.events?.emit?.("apex.intelligence.completed", result);
          return result;
        }

        if (verification.status === "blocked") {
          const result = {
            status: "blocked",
            verified: false,
            goal,
            reason: verification.reason ?? "Verification could not establish completion.",
            evidence: verification.evidence ?? [],
            history,
            startedAt,
            completedAt: new Date().toISOString()
          };
          this.events?.emit?.("apex.intelligence.blocked", result);
          return result;
        }

        state = verification;
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
