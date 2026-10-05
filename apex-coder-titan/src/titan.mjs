import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.mjs";
import { TitanAI, extractText } from "./ai.mjs";
import { assertRepo, assertClean, currentHead, discover, makeWorktree, removeWorktree, git } from "./repo.mjs";
import { discoverChecks, runChecks } from "./checks.mjs";

const SPECIALISTS = [
  ["postgresql", "Audit PostgreSQL schema, migrations, connection pools, indexes, constraints, transaction boundaries, and failure behavior."],
  ["durable-jobs", "Audit durable queue semantics, claim ordering, batching, idempotency, retries, dead-letter behavior, and duplicate execution."],
  ["leases-fencing", "Audit lease ownership, fencing tokens, heartbeats, expiry races, stale workers, and crash recovery."],
  ["worker-fleet", "Audit worker concurrency, capacity-aware claiming, shutdown/drain behavior, backoff, jitter, and multi-node coordination."],
  ["ai-mesh", "Audit provider routing, model selection, timeouts, rate limits, fallback behavior, and durable AI work."],
  ["providers", "Audit external provider contracts, authentication boundaries, error classification, quotas, and retry safety."],
  ["security", "Audit trust boundaries, secrets, injection, path traversal, prototype pollution, unsafe execution, authorization, and fail-closed behavior."],
  ["filesystem", "Audit file paths, atomic writes, temporary files, permissions, cleanup, storage durability, and traversal resistance."],
  ["api", "Audit API contracts, validation, authentication, authorization, status codes, request limits, and concurrency behavior."],
  ["media-render", "Audit FFmpeg/media execution, streaming, cancellation, output integrity, provenance, and render failure recovery."],
  ["performance", "Audit hot paths, worker concurrency, memory behavior, provider limits, batching, resource leaks, and unnecessary work."],
  ["integration", "Audit cross-module contracts, migration/runtime alignment, deployment assumptions, CI/release behavior, and architectural drift."],
  ["product", "Audit whether the implementation actually satisfies the stated Apex product goal and user workflow without cheap shortcuts."]
];

const BREAKERS = SPECIALISTS.map(([name, remit]) => [
  name,
  `Attempt to disprove the ${name} workstream after implementation. ${remit} Construct adversarial races, malformed inputs, stale state, failure injection, and boundary cases. Treat every success claim as unproven until evidence supports it.`
]);

const TOOL_DEFS = [
  {
    type: "function",
    name: "read_file",
    description: "Read a UTF-8 text file inside the confined worktree.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "write_file",
    description: "Atomically replace a UTF-8 text file inside the confined worktree. Protected paths are rejected.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "run_check",
    description: "Run one discovered repository check inside the confined worktree.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false
    }
  }
];

function assertNotAborted(signal) {
  if (signal?.aborted) throw new Error("Titan run cancelled.");
}

function safePath(root, requested) {
  if (typeof requested !== "string" || !requested.trim()) throw new Error("A relative path is required.");
  const normalized = requested.replaceAll("\\", "/");
  const protectedPath = /^(?:\.git(?:\/|$)|\.env(?:\.|$)|(?:^|\/)(?:node_modules|\.titan)(?:\/|$))/i;
  if (protectedPath.test(normalized)) throw new Error("Protected path cannot be modified by Titan.");
  const resolved = path.resolve(root, requested);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Path escapes Titan worktree.");
  return resolved;
}

async function writeAtomic(root, requested, content) {
  const target = safePath(root, requested);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.titan-${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function runToolLoop(ai, { input, previousResponseId = null, tools, execute, signal, onResponse }) {
  let response = await ai.turn({ input, previousResponseId, tools });
  while (true) {
    assertNotAborted(signal);
    onResponse?.(response);
    const calls = (response.output || []).filter(item => item.type === "function_call");
    if (!calls.length) return response;

    const outputs = [];
    for (const call of calls) {
      assertNotAborted(signal);
      let output;
      try {
        const args = JSON.parse(call.arguments || "{}");
        output = await execute(call.name, args);
      } catch (error) {
        output = { error: error.message };
      }
      outputs.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: typeof output === "string" ? output : JSON.stringify(output)
      });
    }
    response = await ai.turn({
      previousResponseId: response.id,
      input: outputs,
      tools
    });
  }
}

async function specialistAudit(ai, snapshot, assignment, specialist, evidence, signal, mode = "builder", diff = "") {
  const [name, remit] = specialist;
  assertNotAborted(signal);
  const response = await ai.turn({
    input: [
      `You are Titan ${mode}: ${name}.`,
      remit,
      mode === "breaker"
        ? "You are the adversarial counterpart. Try to disprove the implementation; do not praise it and do not claim production-ready."
        : "You are the builder-side specialist. Produce concrete, testable findings and implementation requirements; do not claim production-ready.",
      "Assignment:", assignment,
      "Repository snapshot:", JSON.stringify(snapshot),
      "Current evidence:", JSON.stringify(evidence.slice(-20)),
      diff ? "Current worktree diff:", diff : ""
    ].join("\n\n")
  });
  return { name, report: extractText(response), responseId: response.id };
}

function scanSecrets(diff) {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /AKIA[0-9A-Z]{16}/,
    /sk-[A-Za-z0-9]{20,}/,
    /(?:OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}/
  ];
  return patterns.some(pattern => pattern.test(diff));
}

async function finalSecurityScan(worktree) {
  const diff = await git(worktree, ["diff", "--no-ext-diff", "--unified=0"]);
  return { ok: !scanSecrets(diff.stdout), scannedBytes: Buffer.byteLength(diff.stdout, "utf8") };
}

async function persistEvidence(state) {
  await fs.mkdir(config.evidenceDir, { recursive: true });
  const file = path.join(config.evidenceDir, `${state.runId}.json`);
  await fs.writeFile(file, JSON.stringify(state, null, 2), { mode: 0o600 });
  return file;
}

export async function runTitan({ repoPath, assignment, signal, onEvent = () => {} }) {
  const repo = await assertRepo(repoPath);
  await assertClean(repo);
  const runId = crypto.randomUUID();
  const sourceHead = await currentHead(repo);
  const state = {
    runId,
    sourceHead,
    evidenceVerdict: "INCONCLUSIVE",
    requiresFinalInspection: true,
    events: [],
    evidence: [],
    specialists: [],
    repairs: [],
    startedAt: new Date().toISOString()
  };
  let work = null;

  const emit = (event, data = {}) => {
    const record = { at: new Date().toISOString(), event, ...data };
    state.events.push(record);
    onEvent(record);
  };

  try {
    assertNotAborted(signal);
    emit("repo.validated", { repo, sourceHead });

    const snapshot = await discover(repo, config.maxDepth);
    emit("repo.discovered", { branch: snapshot.branch.stdout.trim(), files: snapshot.files.length });

    const checks = await discoverChecks(repo);
    emit("checks.discovered", { checks: checks.map(x => x.name) });

    const ai = new TitanAI(config);
    const initial = await runChecks(repo, checks);
    state.evidence.push(...initial);
    emit("checks.initial", { failed: initial.filter(x => !x.ok).length });

    const runParallel = async (items, worker) => {
      const results = [];
      let cursor = 0;
      const workerCount = Math.min(config.auditConcurrency, items.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (true) {
          const index = cursor++;
          if (index >= items.length) return;
          results[index] = await worker(items[index]);
        }
      }));
      return results;
    };

    const specialistReports = await runParallel(
      SPECIALISTS,
      specialist => specialistAudit(ai, snapshot, assignment, specialist, state.evidence, signal, "builder")
    );
    state.specialists.push(...specialistReports);
    for (const report of specialistReports) emit("audit.complete", { specialist: report.name, mode: "builder" });

    work = await makeWorktree(repo);
    emit("worktree.created", { isolated: true, baseHead: work.baseHead });

    let previousResponseId = null;
    for (let round = 1; round <= config.implementationRounds; round++) {
      assertNotAborted(signal);
      const response = await runToolLoop(ai, {
        input: [
          "You are Apex Coder Titan Lead Architect.",
          "Implement the assignment in the isolated worktree. Never touch remote Git.",
          "Use the available tools. Make small, verifiable changes.",
          "Never weaken security, expose secrets, or delete unrelated functionality.",
          "When blocked, inspect the repository instead of guessing.",
          `Implementation round ${round} of ${config.implementationRounds}.`,
          "Assignment:", assignment,
          "Specialist reports:", JSON.stringify(state.specialists),
          "Current evidence:", JSON.stringify(state.evidence.slice(-20))
        ].join("\n\n"),
        previousResponseId,
        tools: TOOL_DEFS,
        signal,
        execute: async (name, args) => {
          assertNotAborted(signal);
          if (name === "read_file") return await fs.readFile(safePath(work.worktree, args.path), "utf8");
          if (name === "write_file") {
            await writeAtomic(work.worktree, args.path, args.content);
            return "atomic write complete";
          }
          if (name === "run_check") {
            const check = checks.find(item => item.name === args.name);
            return check ? await runChecks(work.worktree, [check]) : { error: "Unknown check." };
          }
          return { error: "Unknown tool." };
        }
      });
      previousResponseId = response.id;
      emit("implementation.round", { round });
      if (/\bimplementation\s+(?:complete|done)\b/i.test(extractText(response))) break;
    }

    for (let pass = 1; pass <= config.repairPasses; pass++) {
      let repairResponseId = null;
      let repaired = false;
      for (let turn = 1; turn <= config.repairTurns; turn++) {
        assertNotAborted(signal);
        const evidence = await runChecks(work.worktree, checks);
        state.evidence.push(...evidence);
        emit("repair.evidence", { pass, turn, failed: evidence.filter(x => !x.ok).length });
        if (evidence.length > 0 && evidence.every(x => x.ok)) {
          repaired = true;
          break;
        }
        const repair = await runToolLoop(ai, {
          input: [
            `Repair pass ${pass} of ${config.repairPasses}; turn ${turn} of ${config.repairTurns}.`,
            "Fix only evidence-backed failures. Do not declare success without checks.",
            JSON.stringify(evidence)
          ].join("\n\n"),
          previousResponseId: repairResponseId,
          tools: TOOL_DEFS,
          signal,
          execute: async (name, args) => {
            if (name === "read_file") return await fs.readFile(safePath(work.worktree, args.path), "utf8");
            if (name === "write_file") {
              await writeAtomic(work.worktree, args.path, args.content);
              return "atomic write complete";
            }
            if (name === "run_check") {
              const check = checks.find(item => item.name === args.name);
              return check ? await runChecks(work.worktree, [check]) : { error: "Unknown check." };
            }
            return { error: "Unknown tool." };
          }
        });
        repairResponseId = repair.id;
        state.repairs.push({ pass, turn, responseId: repair.id, report: extractText(repair) });
        emit("repair.turn.complete", { pass, turn });
      }
      emit("repair.pass.complete", { pass, repaired });
      if (repaired) break;
    }

    assertNotAborted(signal);
    if ((await currentHead(repo)) !== sourceHead) {
      state.evidenceVerdict = "FAIL";
      throw new Error("Source HEAD changed while Titan was running; result rejected as a race.");
    }

    const postImplementationDiff = (await git(work.worktree, ["diff", "--no-ext-diff", "--unified=0"])).stdout;
    const breakerReports = await runParallel(
      BREAKERS,
      breaker => specialistAudit(ai, snapshot, assignment, breaker, state.evidence, signal, "breaker", postImplementationDiff)
    );
    state.breakers = breakerReports;
    for (const report of breakerReports) emit("audit.complete", { specialist: report.name, mode: "breaker" });

    const finalEvidence = await runChecks(work.worktree, checks);
    state.evidence.push(...finalEvidence);
    const security = await finalSecurityScan(work.worktree);
    state.securityScan = security;
    emit("security.scan", security);

    const diff = await git(work.worktree, ["diff", "--stat"]);
    const porcelain = await git(work.worktree, ["status", "--short"]);
    state.diffStat = diff.stdout;
    state.worktreeStatus = porcelain.stdout;

    const allGreen = finalEvidence.length > 0 && finalEvidence.every(item => item.ok) && security.ok;
    if (allGreen) state.evidenceVerdict = "PASS";
    else if (!checks.length) state.evidenceVerdict = "INCONCLUSIVE";
    else state.evidenceVerdict = "FAIL";
    state.requiresFinalInspection = true;

    emit("titan.evidence.verdict", {
      evidenceVerdict: state.evidenceVerdict,
      requiresFinalInspection: true,
      evidenceCount: state.evidence.length,
      checks: finalEvidence.map(item => ({ name: item.name, ok: item.ok })),
      securityOk: security.ok
    });
  } finally {
    if (work) {
      await removeWorktree(repo, work.worktree, work.container);
      emit("worktree.removed");
    }
    state.finishedAt = new Date().toISOString();
    state.evidencePath = await persistEvidence(state).catch(() => null);
  }

  return state;
}
