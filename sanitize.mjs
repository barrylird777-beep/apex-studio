const MAX_LEN = 20000;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const INJECTION = [
  /(ignore|bypass|override)\s+(all\s+)?(prior|system|developer)\s+(instructions|directives|rules)/i,
  /system\s*override/i,
  /you\s+are\s+now\s+(a\s+)?(system\s+administrator|root|admin)/i,
  /<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/i,
  /process\s*\.\s*(env|exit|kill|mainModule|binding)/i,
];

export function sanitizeApexInput(payload) {
  if (typeof payload !== "string") return payload;
  if (payload.length > MAX_LEN) throw new Error("Payload too large");
  if (CONTROL.test(payload)) throw new Error("Control characters not allowed");
  if (INJECTION.some((pattern) => pattern.test(payload))) throw new Error("Payload rejected");
  return payload.normalize("NFC");
}
