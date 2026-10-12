const TRACKING = /(?:googletagmanager|google-analytics|doubleclick|facebook\.com\/tr|hotjar|segment\.io)/ig;
const DANGEROUS = /(?:<script|javascript:|data:text\/html|powershell(?:\.exe)?|cmd(?:\.exe)?\s+\/c|curl\s+[^\s]+\s*\|\s*(?:sh|bash)|wget\s+[^\s]+\s*-O\s*-\s*\|)/ig;

export function cleanUntrustedText(value, max = 50000) {
  let text = String(value ?? "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<[^>]+>/g, " ");
  text = text.replace(TRACKING, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.slice(0, max);
}

export function inspectUntrusted(value) {
  const text = String(value ?? "");
  const indicators = [...new Set(text.match(DANGEROUS) ?? [])].slice(0, 20);
  return { suspicious: indicators.length > 0, indicators, safeText: cleanUntrustedText(text) };
}
