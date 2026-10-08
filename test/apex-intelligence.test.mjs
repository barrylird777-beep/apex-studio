import test from "node:test";
import assert from "node:assert/strict";
import { ApexIntelligence } from "../src/agents/apex-intelligence.mjs";

test("ApexIntelligence completes through diagnose, execute, and verify", async () => {
  const phases = [];
  const intelligence = new ApexIntelligence({
    memory: {
      search() {
        return [{ id: "memory-1", importance: 0.9, content: "cinematic retention" }];
      }
    },
    executor: async input => {
      phases.push(input.phase);
      if (input.phase === "diagnose") return { status: "execute", output: "diagnosis complete" };
      return { status: "verify", output: "production result", evidence: ["render-hash"] };
    },
    verifier: async input => ({
      status: "verified",
      verified: input.evidence.includes("render-hash"),
      evidence: input.evidence
    })
  });

  const result = await intelligence.run("Create a cinematic Scripture sequence", {
    projectId: "project-1",
    focus: "visual"
  });

  assert.equal(result.status, "complete");
  assert.equal(result.verified, true);
  assert.deepEqual(phases, ["diagnose", "execute"]);
  assert.equal(result.specialists[0].name, "Visual Director");
});

test("ApexIntelligence uses recovery after a blocked execution", async () => {
  let recovered = false;
  const intelligence = new ApexIntelligence({
    executor: async input => {
      if (input.phase === "diagnose") return { status: "blocked", reason: "provider unavailable" };
      return { status: "verify", output: "recovered result", evidence: ["fallback-provider"] };
    },
    recoverer: async () => {
      recovered = true;
      return { status: "execute", output: "fallback selected" };
    },
    verifier: async input => ({
      status: "verified",
      verified: input.evidence.includes("fallback-provider"),
      evidence: input.evidence
    })
  });

  const result = await intelligence.run("Generate an image", { type: "visual" });

  assert.equal(recovered, true);
  assert.equal(result.status, "complete");
  assert.equal(result.verified, true);
});

test("ApexIntelligence blocks repeated states instead of looping forever", async () => {
  const intelligence = new ApexIntelligence({
    executor: async () => ({ status: "execute", output: "unchanged" }),
    verifier: async () => ({ status: "retry", reason: "insufficient evidence" })
  });

  const result = await intelligence.run("Verify a result");

  assert.equal(result.status, "blocked");
  assert.match(result.reason, /repeated state/i);
});


test("ApexIntelligence can execute independent specialist tasks in parallel", async () => {
  const intelligence = new ApexIntelligence({
    executor: async input => {
      if (input.phase === "diagnose") {
        return { status: "parallelize", tasks: [{ task: "visual" }, { task: "audio" }] };
      }
      return { status: "verify", output: "combined", evidence: ["parallel"] };
    },
    verifier: async input => ({ status: "verified", verified: input.evidence.includes("parallel"), evidence: input.evidence })
  });

  const result = await intelligence.run("Build a visual and audio plan", { focus: "visual audio" });
  assert.equal(result.status, "complete");
  assert.equal(result.verified, true);
});

test("ApexIntelligence requires verification quorum when multiple reviewers are configured", async () => {
  const intelligence = new ApexIntelligence({
    executor: async input => input.phase === "diagnose"
      ? { status: "execute", output: "candidate" }
      : { status: "verify", output: "candidate", evidence: ["evidence-1"] },
    verifiers: [
      async () => ({ status: "verified", verified: true, evidence: ["review-a"] }),
      async () => ({ status: "verified", verified: true, evidence: ["review-b"] }),
      async () => ({ status: "retry", verified: false, evidence: ["review-c"] })
    ]
  });

  const result = await intelligence.run("Verify a candidate", { verificationQuorum: 2 });
  assert.equal(result.status, "complete");
  assert.deepEqual(result.quorum, { required: 2, approvals: 2, reviewers: 3 });
  assert.equal(result.reviews.length, 3);
});

test("ApexIntelligence can submit durable work without executing it inline", async () => {
  let submitted = null;
  const intelligence = new ApexIntelligence({
    executor: async () => ({ status: "verify", output: "unused" }),
    verifier: async () => ({ status: "verified", verified: true }),
    durableQueue: async payload => {
      submitted = payload;
      return { durable: true, id: "job-42" };
    }
  });

  const result = await intelligence.enqueueDurable("Research Psalm 23", {
    projectId: "project-1",
    traceId: "trace-1",
    priority: 900
  });

  assert.equal(result.id, "job-42");
  assert.equal(submitted.task, "apex.intelligence.run");
  assert.equal(submitted.role, "intelligence");
  assert.equal(submitted.payload.goal, "Research Psalm 23");
});
