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

export async function executeCrewInference(prompt, system = DEFAULT_SYSTEM) {
  const input = String(prompt || "").trim();
  if (!input) throw new Error("Crew inference prompt is required");
  const failures = [];

  const gemini = new GeminiMeshProvider();
  const claude = new ClaudeMeshProvider();

  const providers = [
    ["gemini", () => gemini.generate(input, { system })],
    ["claude", () => claude.generate(input, { system, model: claude.model })],
    ["groq-free", () => groq(input, system)],
    ["pollinations", () => pollinations(input, system)]
  ];

  for (const [name, call] of providers) {
    try {
      const result = await call();
      return typeof result === "string"
        ? { text: result, provider: name, failures }
        : { ...result, failures };
    } catch (error) {
      failures.push(`${name}: ${String(error?.message || error)}`);
    }
  }

  throw new Error(`AI crew inference exhausted: ${failures.join(" | ")}`);
}
