import { validateHookPlan, LABELS, HOOK_RULES } from './hook.mjs';

export const MAX_WORDS_PER_SHOT = 9;

export function buildHookPrompt({ ref, events, visualBible = {}, errors = [] }) {
  const names = Object.keys(visualBible);
  return [
    `You are writing the first 30 seconds of a cinematic Bible-story video (${ref}).`,
    'Write a HOOK, not a summary. Return ONLY JSON: {"title": string, "shots": [...]}.',
    'Each shot: {"durationSec": number, "motion": "zoom_in"|"zoom_out"|"pan_left"|"pan_right",',
    '"visual": string, "characters": string[], "narration": string, "labels": string[], "sources": string[]}.',
    '',
    'RULES:',
    `- 9 to 12 shots, each ${HOOK_RULES.minShotSec}-${HOOK_RULES.maxShotSec} seconds, total ${HOOK_RULES.minTotalSec}-${HOOK_RULES.maxTotalSec} seconds.`,
    '- Shot 1 is the most striking image. No title card, logo, or intro bumper.',
    `- Narration begins at 0 seconds. First line is quotable alone, at most ${HOOK_RULES.maxFirstLineWords} words, and must not use a throat-clearing opener.`,
    `- Every shot MUST contain narration, and every narration line is at most ${MAX_WORDS_PER_SHOT} words.`,
    '- Structure: cold open with stakes; escalation; premise; open loop.',
    '- Stay faithful to the supplied events. Never invent a Scripture reference.',
    '- "sources" values MUST be copied exactly from the supplied events.',
    '- Do not quote a Bible translation verbatim; paraphrase.',
    '- Use "dramatization" when a shot adds imagined dialogue, staging, emotion, or other details not directly established by the supplied events.',
    names.length ? `- Known characters (use these names exactly): ${names.join(', ')}.` : '',
    '',
    'EVENTS:',
    JSON.stringify(events, null, 2),
    errors.length ? `\nPrevious attempt rejected. Fix every issue:\n- ${errors.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}

export function groundedErrors(plan, events) {
  const allowedSources = new Set(events.flatMap((event) => event.sources ?? []));
  const errors = [];
  for (const shot of plan.shots ?? []) {
    for (const source of shot.sources ?? []) {
      if (!allowedSources.has(source)) errors.push(`shot ${shot.id}: source "${source}" is not in the provided events`);
    }
  }
  return errors;
}

export function narrationLengthErrors(plan, max = MAX_WORDS_PER_SHOT) {
  return (plan.shots ?? [])
    .filter((shot) => typeof shot.narration !== 'string' || !shot.narration.trim())
    .map((shot) => `shot ${shot.id}: narration is required`)
    .concat(
      (plan.shots ?? [])
        .filter((shot) => typeof shot.narration === 'string' && shot.narration.trim().split(/\s+/).length > max)
        .map((shot) => `shot ${shot.id}: narration over ${max} words`),
    );
}

function normalize(ref, json) {
  if (!Array.isArray(json?.shots)) throw new Error('response has no shots array');
  return {
    ref,
    title: String(json.title ?? ref),
    narrationStartSec: 0,
    shots: json.shots.map((shot, index) => ({
      id: `s${index}`,
      kind: 'scene',
      durationSec: Number(shot.durationSec),
      motion: shot.motion,
      visual: shot.visual,
      characters: Array.isArray(shot.characters) ? shot.characters : [],
      narration: typeof shot.narration === 'string' ? shot.narration : '',
      labels: Array.isArray(shot.labels) ? shot.labels : [],
      sources: Array.isArray(shot.sources) ? shot.sources : [],
      image: null,
    })),
  };
}

export async function generateHookPlan({ gemini, ref, events, visualBible = {}, maxAttempts = 3 }) {
  if (!Array.isArray(events) || events.length === 0 || events.some((event) => !event?.sources?.length)) {
    throw new Error('events must be a non-empty array and every event needs sources');
  }
  const badEvents = events.flatMap((event) => {
    const errors = [];
    if (!event?.id) errors.push('event is missing id');
    if (!LABELS.includes(event?.label)) errors.push(`event ${event?.id ?? '?'} has invalid label`);
    return errors;
  });
  if (badEvents.length) throw new Error(badEvents.join('; '));

  let errors = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const json = await gemini.generateJson(buildHookPrompt({ ref, events, visualBible, errors }));
    let plan;
    try { plan = normalize(ref, json); }
    catch (error) { errors = [error.message]; continue; }
    errors = [
      ...validateHookPlan(plan).errors,
      ...groundedErrors(plan, events),
      ...narrationLengthErrors(plan),
    ];
    if (errors.length === 0) return plan;
  }
  throw new Error(`hook plan rejected after ${maxAttempts} attempts:\n- ${errors.join('\n- ')}`);
}
