import crypto from "node:crypto";

const MAX_PROMPT = 5000;
const MAX_DRAFT = 12000;
const MODES = new Set(["practice", "scaffold", "review"]);
const sessions = new Map();

function clean(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function analyzePrompt(promptText, mode, userDraft) {
  const lower = promptText.toLowerCase();
  const breakdown = [
    "Primary objective: identify the required outcome and acceptance criteria.",
    "Constraint vector: separate explicit requirements from assumptions.",
    "Ambiguity vector: identify boundary conditions, undefined terms, and missing inputs.",
    "Evidence vector: distinguish observed facts, generated hypotheses, and items requiring verification."
  ];
  const edgeCases = [
    "Empty, null, and missing fields.",
    "Malformed or unexpectedly typed payloads.",
    "Concurrent requests and repeated execution.",
    "Timeouts, partial failure, and retry behavior.",
    "Maximum-size input and resource exhaustion."
  ];
  if (/auth|token|secret|credential|password|key/i.test(lower)) edgeCases.push("Expired, revoked, leaked, or incorrectly scoped credentials.");
  if (/network|http|url|fetch|socket|dns/i.test(lower)) edgeCases.push("Redirects, DNS rebinding, private/link-local targets, and connection resets.");
  if (/database|sql|postgres|transaction/i.test(lower)) edgeCases.push("Transaction rollback, duplicate delivery, deadlocks, and stale writes.");
  const scaffold = [
    "// CHATTYKOB practice scaffold — generated, not verified.",
    "// Mode: " + mode,
    "// Task: " + JSON.stringify(promptText.slice(0, 160)),
    "",
    "export function evaluateHypothesis(input) {",
    "  if (input == null) throw new TypeError('input is required');",
    "  // 1. State the invariant.",
    "  // 2. Test normal and boundary cases.",
    "  // 3. Record assumptions and evidence.",
    "  // 4. Keep verification separate from generated suggestions.",
    "  return { verified: false, evidence: [], findings: [] };",
    "}"
  ].join("\n");
  return {
    breakdown,
    edgeCases,
    scaffold,
    feedback: userDraft ? [
      "Draft received: " + userDraft.length + " characters.",
      "Check whether every major claim has supporting evidence.",
      "Check failure handling and boundary conditions before treating the draft as complete."
    ] : null
  };
}

export function createEvalCopilotHandler() {
  return async function handleEvalCopilot(req, res, pathname, readBody, send) {
    if (pathname === "/api/copilot/templates" && req.method === "GET") {
      return send(res, 200, {
        modes: ["practice", "scaffold", "review"],
        limits: { prompt: MAX_PROMPT, draft: MAX_DRAFT },
        generatedArtifacts: { verified: false }
      });
    }
    if (pathname !== "/api/copilot/analyze" || req.method !== "POST") return false;

    const body = await readBody(req);
    const promptText = clean(body.promptText, MAX_PROMPT);
    const userDraft = clean(body.userDraft, MAX_DRAFT);
    const mode = String(body.mode || "practice");

    if (typeof body.promptText !== "string" || promptText.length < 5) {
      return send(res, 400, { error: "Valid prompt text is required." });
    }
    if (body.promptText.length > MAX_PROMPT) {
      return send(res, 400, { error: "Prompt text exceeds the 5000-character limit." });
    }
    if (body.userDraft !== undefined && (typeof body.userDraft !== "string" || body.userDraft.length > MAX_DRAFT)) {
      return send(res, 400, { error: "Draft exceeds the 12000-character limit." });
    }
    if (!MODES.has(mode)) return send(res, 400, { error: "Unsupported copilot mode." });

    const sessionId = crypto.randomBytes(16).toString("hex");
    const analysis = {
      sessionId,
      timestamp: Date.now(),
      mode,
      ...analyzePrompt(promptText, mode, userDraft),
      verified: false
    };
    sessions.set(sessionId, analysis);
    if (sessions.size > 500) {
      const oldest = sessions.keys().next().value;
      if (oldest) sessions.delete(oldest);
    }
    return send(res, 200, { status: "OK", analysis });
  };
}
