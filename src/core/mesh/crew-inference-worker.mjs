import { GeminiMeshProvider } from "./gemini-mesh-provider.mjs";
import { ClaudeMeshProvider } from "./claude-mesh-provider.mjs";

const DEFAULT_SYSTEM =
  "You are Apex Studio production intelligence. Do not invent sources, repository facts, tests, files, APIs, or capabilities. Separate verified facts from inference.";

async function pollinations(prompt, system) {
  const fullPrompt = encodeURIComponent(`${system}\n\nTask: ${prompt}`);
  const model = encodeURIComponent(process.env.POLLINATIONS_TEXT_MODEL || "mistral");
  for (const url of [
    `https://text.pollinations.ai/${fullPrompt}?model=${model}`,
    `https://gen.pollinations.ai/text/${fullPrompt}?model=${model}`
  ]) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) continue;
      const text = (await response.text()).trim();
      if (text) return { text, provider: "pollinations" };
    } catch (_) {}
  }
  throw new Error("Pollinations text fallbacks exhausted");
}

async function groq(prompt, system) {
  if (!process.env.GROQ_API_KEY) throw new Error("Groq not configured");
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ],
      temperature: 0.8
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Groq ${response.status}`);
  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty Groq response");
  return { text, provider: "groq-free" };
}

const CREW_ROLES = Object.freeze({
  researcher: "Researcher: extract evidence, identify gaps, and preserve source provenance.",
  verifier: "Verifier: challenge claims, detect unsupported assertions, and separate fact from inference.",
  scriptwriter: "Scriptwriter: turn verified material into an engaging production script with a compelling opening.",
  story_editor: "Story Editor: improve structure, pacing, clarity, and retention without corrupting source claims.",
  visual_director: "Visual Director: translate scenes into cinematic visual direction, composition, motion, and style.",
  cinematographer: "Cinematographer: specify shots, lenses, framing, lighting, camera movement, and continuity.",
  voice_director: "Voice Director: specify narration performance, delivery, pacing, emphasis, and character voice direction.",
  audio_director: "Audio Director: design dialogue, ambience, transitions, mixing intent, and audio cues.",
  composer: "Composer: design musical identity, themes, instrumentation, dynamics, and cue structure.",
  sfx_designer: "SFX Designer: design sound effects, textures, impacts, transitions, and sync points.",
  editor: "Editor: assemble the production plan with timing, continuity, transitions, and retention beats.",
  qc: "QC Inspector: identify factual, continuity, technical, provenance, and production defects before release.",
  general: "Production intelligence: solve the assigned Apex Studio task precisely and report uncertainty."
});

function roleSystem(role, system) {
  const key = String(role || "general").trim().toLowerCase().replace(/[- ]+/g, "_");
  return [system, CREW_ROLES[key] || CREW_ROLES.general, `Assigned crew role: ${key}`].join("\n\n");
}

export async function executeCrewInference(prompt, system = DEFAULT_SYSTEM, options = {}) {
  const input = String(prompt || "").trim();
  if (!input) throw new Error("Crew inference prompt is required");
  const role = options?.role || "general";
  const crewSystem = roleSystem(role, system);
  const failures = [];
  const gemini = new GeminiMeshProvider();
  const claude = new ClaudeMeshProvider();
  const providers = [
    ["gemini", () => gemini.generate(input, { system: crewSystem })],
    ["claude", () => claude.generate(input, { system: crewSystem, model: claude.model })],
    ["groq-free", () => groq(input, crewSystem)],
    ["pollinations", () => pollinations(input, crewSystem)]
  ];
  for (const [name, call] of providers) {
    try {
      const result = await call();
      return typeof result === "string"
        ? { text: result, provider: name, role, failures }
        : { ...result, provider: result.provider || name, role, failures };
    } catch (error) {
      failures.push(`${name}: ${String(error?.message || error)}`);
    }
  }
  throw new Error(`AI crew inference exhausted for role ${role}: ${failures.join(" | ")}`);
}
