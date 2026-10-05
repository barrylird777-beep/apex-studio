import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.mjs";
import { TitanAI, extractText } from "./ai.mjs";
import { assertRepo, discover, makeWorktree, removeWorktree, git } from "./repo.mjs";
import { discoverChecks, runChecks } from "./checks.mjs";

const SPECIALISTS = [
  ["security", "Audit trust boundaries, secrets, injection, path traversal, prototype pollution, unsafe execution, and authorization."],
  ["data", "Audit persistence, migrations, PostgreSQL correctness, transactions, idempotency, leases, concurrency, and recovery."],
  ["reliability", "Audit crash recovery, timeouts, retries, cancellation, resource exhaustion, race conditions, and deterministic behavior."],
  ["testing", "Audit test coverage, acceptance criteria, negative cases, smoke checks, and evidence quality."],
  ["performance", "Audit hot paths, worker concurrency, memory behavior, provider limits, batching, and unnecessary work."],
  ["product", "Audit whether the implementation actually satisfies the stated Apex product goal and user workflow without cheap shortcuts."]
];

const TOOL_DEFS = [
  {
    type: "function",
    name: "read_file",
    description: "Read a text file inside the confined worktree.",
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
    description: "Atomically replace a text file inside the confined worktree. Paths must stay inside the worktree.",
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

function safePath(root, requested) {
  const resolved = path.resolve(root, requested);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Path escapes Titan worktree.");
  return resolved;
}

async function writeAtomic(root, requested, content) {
  const target = safePath(root, requested);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.titan-${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, target);
}

async function specialistAudit(ai, repoSnapshot, assignment, specialist, context) {
  const [name, remit] = specialist;
  const prompt = [
    `You are Titan specialist: ${name}.`,
    remit,
    "Do not claim production-ready. Produce concrete, testable findings.",
    "Assignment:", assignment,
    "Repository snapshot:", JSON.stringify(repoSnapshot),
    "Current evidence:", JSON.stringify(context)
  ].join("\n\n");
  const response = await ai.turn({ input: prompt });
  return { name, report: extractText(response), responseId: response.id };
}

export async function runTitan({ repoPath, assignment, onEvent = () => {} }) {
  const repo = await assertRepo(repoPath);
  const runId = crypto.randomUUID();
  const state = { runId, verdict: "RED", events: [], evidence: [], specialists: [], repairs: [] };
  const emit = (event, data = {}) => {
    const record = { at: new Date().toISOString(), event, ...data };
    state.events.push(record);
    onEvent(record);
  };

  emit("repo.validated", { repo });
  const snapshot = await discover(repo, config.maxDepth);
  emit("repo.discovered", { branch: snapshot.branch.stdout.trim(), files: snapshot.files.length });

  const checks = await discoverChecks(repo);
  emit("checks.discovered", { checks: checks.map(x => x.name) });

  const ai = new TitanAI(config);
  const initial = await runChecks(repo, checks);
  state.evidence.push(...initial);
  emit("checks.initial", { failed: initial.filter(x => !x.ok).length });

  for (const specialist of SPECIALISTS) {
    const report = await specialistAudit(ai, snapshot, assignment, specialist, state.evidence);
    state.specialists.push(report);
    emit("audit.complete", { specialist: report.name });
  }

  const work = await makeWorktree(repo);
  emit("worktree.created", { isolated: true });

  try {
    let previousResponseId = null;
    for (let round = 1; round <= config.implementationRounds; round++) {
      const prompt = [
        "You are Apex Coder Titan Lead Architect.",
        "Implement the assignment in the isolated worktree. Do not touch remote Git.",
        "Use the available tools. Make small, verifiable changes.",
        "Never weaken security or delete unrelated functionality.",
        "When blocked, inspect the repository instead of guessing.",
        `Implementation round ${round} of ${config.implementationRounds}.`,
        "Assignment:", assignment,
        "Specialist reports:", JSON.stringify(state.specialists),
        "Current evidence:", JSON.stringify(state.evidence.slice(-20))
      ].join("\n\n");

      const response = await ai.turn({
        input: prompt,
        previousResponseId,
        tools: TOOL_DEFS
      });
      previousResponseId = response.id;
      emit("implementation.round", { round });

      const toolCalls = (response.output || []).filter(x => x.type === "function_call");
      for (const call of toolCalls) {
        const args = JSON.parse(call.arguments || "{}");
        let output;
        if (call.name === "read_file") {
          const target = safePath(work.worktree, args.path);
          output = await fs.readFile(target, "utf8");
        } else if (call.name === "write_file") {
          await writeAtomic(work.worktree, args.path, args.content);
          output = "atomic write complete";
        } else if (call.name === "run_check") {
          const check = checks.find(x => x.name === args.name);
          output = check ? await runChecks(work.worktree, [check]) : { error: "Unknown check." };
        } else {
          output = { error: "Unknown tool." };
        }
        const follow = await ai.turn({
          previousResponseId: response.id,
          input: [{ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) }],
          tools: TOOL_DEFS
        });
        previousResponseId = follow.id;
      }

      const text = extractText(response);
      if (/\bimplementation\s+(?:complete|done)\b/i.test(text)) break;
    }

    for (let pass = 1; pass <= config.repairPasses; pass++) {
      const evidence = await runChecks(work.worktree, checks);
      state.evidence.push(...evidence);
      emit("repair.evidence", { pass, failed: evidence.filter(x => !x.ok).length });
      if (evidence.every(x => x.ok)) break;
      if (pass === config.repairPasses) break;
      const repair = await ai.turn({
        input: [
          `Repair pass ${pass} of ${config.repairPasses}; maximum ${config.repairTurns} turns.`,
          "Fix only evidence-backed failures. Do not declare success without checks.",
          JSON.stringify(evidence)
        ].join("\n\n"),
        tools: TOOL_DEFS
      });
      state.repairs.push({ pass, responseId: repair.id, report: extractText(repair) });
      emit("repair.complete", { pass });
    }

    const finalEvidence = await runChecks(work.worktree, checks);
    state.evidence.push(...finalEvidence);
    const diff = await git(work.worktree, ["diff", "--stat"]);
    const porcelain = await git(work.worktree, ["status", "--short"]);
    state.diffStat = diff.stdout;
    state.worktreeStatus = porcelain.stdout;
    const allGreen = finalEvidence.length > 0 && finalEvidence.every(x => x.ok);
    state.verdict = allGreen ? "GREEN" : "RED";
    emit("king-cob.verdict", { verdict: state.verdict, evidenceCount: state.evidence.length });
  } finally {
    await removeWorktree(repo, work.worktree, work.container);
    emit("worktree.removed");
  }

  return state;
}
