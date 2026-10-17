import { generateMax } from "../providers/openai-max-router.mjs";

export async function generateWithOpenAI({ system, prompt, model }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  const result = await generateMax({ system, prompt, model });
  const text = result?.text ?? result?.output_text ?? result?.response ?? "";
  if (!String(text).trim()) throw new Error("OpenAI returned an empty response");
  return String(text);
}
