const MAX_LEN = 200000;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g;
const ESCAPED_CONTROL = /\\u(?:000[0-8B-C]|001[0-9A-F]|007F|200[BE-F]|202[AE-F]|206[6-9])/gi;
const INJECTION = [
  /(ignore|bypass|override)\s+(all\s+)?(prior|previous|system|developer)\s+(system\s+)?(instructions|directives|rules)/i,
  /system\s*override/i,
  /you\s+are\s+now\s+(a\s+)?(system\s+administrator|root|admin)/i,
  /respond\s+only\s+with/i,
  /<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/i,
  /process\s*\.\s*(env|exit|kill|mainModule|binding)/i,
];
export function sanitizeApexInput(payload, strict = true) {
  if (typeof payload !== "string") return payload;
  if (payload.length > MAX_LEN) throw new Error("Payload too large");
  const clean = payload.replace(CONTROL, "").replace(ESCAPED_CONTROL, "").normalize("NFC");
  if (strict && INJECTION.some((p) => p.test(clean))) throw new Error("Payload rejected");
  return clean;
}