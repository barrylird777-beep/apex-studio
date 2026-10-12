const TAG = /\[([a-zA-Z][\w.-]*)(?:=([^\]]+))?\]/g;
export const PROSODY_TAGS = Object.freeze(["emotion","pace","pitch","rate","volume","breath","pause","emphasis","style","voice"]);
export function parseProsody(input) {
  const source = String(input ?? "");
  const tags = [];
  const text = source.replace(TAG, (_, key, value) => {
    if (!PROSODY_TAGS.includes(key.toLowerCase())) return _;
    tags.push({ key: key.toLowerCase(), value: value?.trim() ?? true });
    return "";
  }).replace(/\s+/g, " ").trim();
  return { text, tags };
}
