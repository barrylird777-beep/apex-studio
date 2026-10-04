import { LABELS } from './hook.mjs';

export const EVENTS_VERSION = 'events-v1';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
export const bookOf = (s) => String(s).trim().replace(/\s+\d.*$/, '');
const bookKey = (s) => norm(bookOf(s)).slice(0, 3);
const chapterOf = (s) => Number(/\s(\d+)/.exec(String(s).trim())?.[1]);

export function chapterRange(ref) {
  const text = String(ref).trim();
  const book = bookOf(text);
  const rest = text.slice(book.length);
  const colon = [...rest.matchAll(/(\d+)(?=:)/g)].map((m) => Number(m[1]));
  const nums = colon.length ? colon : [...rest.matchAll(/\d+/g)].map((m) => Number(m[0]));
  if (nums.length === 0) throw new Error(`cannot find a chapter in ref "${ref}"`);
  return { lo: Math.min(...nums), hi: Math.max(...nums) };
}

export function validateEvents(events, ref) {
  const errors = [];
  if (!Array.isArray(events) || events.length === 0) return ['events must be a non-empty array'];
  const { lo, hi } = chapterRange(ref);
  const key = bookKey(ref);
  const ids = new Set();

  events.forEach((e, i) => {
    const at = `event ${e?.id ?? i}`;
    if (!e || typeof e !== 'object') { errors.push(`${at}: not an object`); return; }
    if (ids.has(e.id)) errors.push(`${at}: duplicate id`);
    if (e.id != null) ids.add(e.id);
    if (typeof e.summary !== 'string' || !e.summary.trim()) errors.push(`${at}: missing summary`);
    if (!LABELS.includes(e.label)) errors.push(`${at}: label "${e.label}" must be one of ${LABELS.join('|')}`);
    if (!Array.isArray(e.sources) || e.sources.length === 0) {
      errors.push(`${at}: needs at least one source`);
      return;
    }
    for (const src of e.sources) {
      if (typeof src !== 'string') { errors.push(`${at}: source is not a string`); continue; }
      const ch = chapterOf(src);
      if (bookKey(src) !== key) errors.push(`${at}: source "${src}" is outside ${bookOf(ref)}`);
      else if (!Number.isFinite(ch) || ch < lo || ch > hi) errors.push(`${at}: source "${src}" is outside chapters ${lo}-${hi}`);
    }
  });
  return errors;
}

export function buildEventsPrompt({ ref, errors = [] }) {
  return [
    `List the key narrative events of ${ref} in chronological order, for a cinematic video script.`,
    'Return ONLY JSON: {"events":[{"id":string,"summary":string,"sources":string[],"label":string,"characters":string[]}]}',
    '',
    'RULES:',
    '- 6 to 15 events. "id" values unique, like "e1", "e2".',
    '- "summary" is one plain sentence in your own words. Do not quote any Bible translation.',
    `- "sources" must be references inside ${ref} only, for example "Gen 37:3-4". Never cite outside the passage.`,
    '- "scripture" means the passage itself states the event. Use "tradition" or "scholarly" for later interpretation.',
    '- Use "dramatization" or "original" for invented or inferred details.',
    `- "label" must be one of: ${LABELS.join(', ')}.`,
    errors.length ? `\nPrevious attempt rejected. Fix every error:\n- ${errors.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}

export async function generateEvents({ gemini, ref, maxAttempts = 3 }) {
  chapterRange(ref);
  let errors = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const json = await gemini.generateJson(buildEventsPrompt({ ref, errors }), { temperature: 0.4 });
    const events = Array.isArray(json?.events)
      ? json.events.map((e, i) => ({
          id: e?.id ?? `e${i + 1}`,
          summary: e?.summary,
          sources: e?.sources,
          label: e?.label,
          characters: Array.isArray(e?.characters) ? e.characters : [],
        }))
      : null;
    errors = events ? validateEvents(events, ref) : ['response has no events array'];
    if (errors.length === 0) return events;
  }
  throw new Error(`events rejected after ${maxAttempts} attempts:\n- ${errors.join('\n- ')}`);
}
