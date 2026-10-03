import { parentPort } from "node:worker_threads";

function extract(value) {
  const text = String(value ?? "");
  const normalized = text.replace(/\\s+/g, " ").trim();
  const fragments = [];
  const size = 4000;
  for (let offset = 0, index = 0; offset < normalized.length; offset += size, index += 1) {
    const chunk = normalized.slice(offset, offset + size);
    if (chunk) fragments.push({ index, offset, text: chunk });
  }
  return fragments;
}

function regexExtract(text, pattern, flags = "giu") {
  const source = String(pattern ?? "");
  if (!source) return [];
  const re = new RegExp(source, flags);
  return [...String(text ?? "").matchAll(re)].map(match => ({
    index: match.index ?? -1,
    text: match[0],
    groups: match.groups ?? null
  }));
}

parentPort?.on("message", message => {
  try {
    if (message?.op === "fragment") {
      parentPort.postMessage({ id: message.id, ok: true, value: extract(message.text) });
      return;
    }
    if (message?.op === "regex") {
      parentPort.postMessage({
        id: message.id,
        ok: true,
        value: regexExtract(message.text, message.pattern, message.flags)
      });
      return;
    }
    if (message?.op === "serialize") {
      parentPort.postMessage({
        id: message.id,
        ok: true,
        value: JSON.stringify(message.value ?? null)
      });
      return;
    }
    parentPort.postMessage({ id: message?.id, ok: false, error: "Unsupported worker operation" });
  } catch (error) {
    parentPort.postMessage({ id: message?.id, ok: false, error: error.message });
  }
});
