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
