const providers = [
  ["Gemini", process.env.GEMINI_API_KEY, process.env.GEMINI_MODEL || "gemini-2.5-flash-lite"],
  ["Claude", process.env.ANTHROPIC_API_KEY, process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5"]
];
for (const [name, key, model] of providers) {
  console.log(JSON.stringify({ provider: name, configured: Boolean(key), model }));
}
if (!providers.some(([, key]) => key)) {
  console.log("No direct AI provider credentials configured.");
}
