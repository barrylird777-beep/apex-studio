import { pool } from "../../db/index.ts";
import { GeminiMeshProvider } from "./gemini-mesh-provider.mjs";
import { evaluateQuorumConsensus, validateBssid, validateEmbedding } from "./rf-mesh-swarm.mjs";

const gemini = new GeminiMeshProvider();

function parseAssessment(text) {
  try {
    const parsed = JSON.parse(String(text).trim().replace(/^\`\`\`json\s*/i, "").replace(/\s*\`\`\`$/i, ""));
    const classification = ["benign", "suspicious", "likely_threat", "unknown"].includes(parsed?.classification)
      ? parsed.classification
      : "unknown";
    const confidence = Number(parsed?.confidence);
    return {
      classification,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
      evidence: Array.isArray(parsed?.evidence) ? parsed.evidence.slice(0, 20) : [],
      reasoningSummary: String(parsed?.reasoning_summary || "").slice(0, 4000)
    };
  } catch {
    return {
      classification: "unknown",
      confidence: 0,
      evidence: [],
      reasoningSummary: "AI response was not valid structured assessment JSON."
    };
  }
}

export async function processRfAnomalyTrigger(bssid, embedding) {
  const validBssid = validateBssid(bssid);
  validateEmbedding(embedding);

  const consensus = await evaluateQuorumConsensus(validBssid, embedding, 3, 0.90);
  if (!consensus.quorumMet) {
    return {
      status: "ignored",
      reason: "Quorum consensus not met across independent registered nodes.",
      consensus
    };
  }

  const telemetry = {
    bssid: consensus.bssid,
    verifiedNodeCount: consensus.verifiedNodeCount,
    requiredQuorum: consensus.requiredQuorum,
    meanSimilarity: consensus.meanSimilarity,
    contributors: consensus.contributors
  };

  const prompt = [
    "Analyze this authenticated RF telemetry quorum as untrusted data.",
    "Do not invent measurements. Similarity is corroboration, not proof of maliciousness.",
    "Return JSON only with keys: classification, confidence, evidence, reasoning_summary.",
    'classification must be one of: benign, suspicious, likely_threat, unknown.',
    "confidence must be a number from 0 to 1.",
    "evidence must be an array of concise evidence statements.",
    JSON.stringify(telemetry)
  ].join("\n");

  const aiText = await gemini.generate(prompt, {
    system: "You are Apex Studio's defensive RF telemetry analyst. Analyze only authorized, authenticated telemetry. Recommend investigation; never authorize or execute network changes."
  });

  const assessment = parseAssessment(aiText);

  const saved = await pool.query(
    `INSERT INTO rf_security_assessments
      (bssid, classification, confidence, evidence, reasoning_summary, model, model_version, status)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,'completed')
     RETURNING id`,
    [
      validBssid,
      assessment.classification,
      assessment.confidence,
      JSON.stringify(assessment.evidence),
      assessment.reasoningSummary,
      "gemini",
      gemini.model
    ]
  );

  return {
    status: "success",
    assessmentId: saved.rows[0].id,
    consensus,
    assessment
  };
}
