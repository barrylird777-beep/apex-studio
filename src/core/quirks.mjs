import { uid, now } from "./id.mjs";

export const QUIRK_TYPES = Object.freeze([
  "easter-egg",
  "story-spark",
  "visual-prompt",
  "sound-cue",
  "viewer-challenge",
  "behind-the-scenes"
]);

export const QUIRK_OUTCOME_SIGNALS = Object.freeze([
  "rewatches",
  "retention",
  "comments",
  "shares",
  "likes",
  "returning-viewers",
  "challenge-participation"
]);

const SPARKS = Object.freeze([
  { id:"hidden-symbol", title:"Hidden Symbol", description:"Place one subtle, story-relevant visual symbol for attentive viewers to discover.", safe:"Never alter Scripture or imply a hidden biblical meaning that the source does not support." },
  { id:"pause-frame", title:"Freeze the Moment", description:"Design one visually striking frame that rewards pausing or replaying.", safe:"The frame must remain faithful to the scene and source." },
  { id:"echo-line", title:"Echo Line", description:"Let a later scene intentionally echo an earlier phrase or image when the story supports it.", safe:"Do not manufacture quotations and label dramatization when applicable." },
  { id:"watch-again", title:"Watch-Again Detail", description:"Plant a continuity detail that becomes clearer after the full episode.", safe:"The detail must be production/cinematic, not fabricated Scripture." },
  { id:"series-thread", title:"Universe Thread", description:"Connect an episode to an existing Apex universe thread or recurring visual motif.", safe:"Only use established canon or clearly fictional production motifs." }
]);

export function createQuirk(input={}) {
  return {
    id: input.id ?? uid("quirk"),
    type: QUIRK_TYPES.includes(input.type) ? input.type : "story-spark",
    title: String(input.title ?? "").trim(),
    description: String(input.description ?? "").trim(),
    sourceRefs: Array.isArray(input.sourceRefs) ? [...input.sourceRefs] : [],
    sceneIds: Array.isArray(input.sceneIds) ? [...input.sceneIds] : [],
    expectedSignals: Array.isArray(input.expectedSignals)
      ? input.expectedSignals.filter(x => QUIRK_OUTCOME_SIGNALS.includes(x))
      : [],
    optional: input.optional !== false,
    status: input.status ?? "suggested",
    createdAt: input.createdAt ?? now()
  };
}

export function recordQuirkOutcome(quirk={}, input={}) {
  const signal = String(input.signal ?? "").trim();
  if (!QUIRK_OUTCOME_SIGNALS.includes(signal)) {
    throw new TypeError(`Unknown quirk outcome signal: ${signal}`);
  }
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError("Quirk outcome value must be a non-negative number.");
  }
  return {
    quirkId: quirk.id ?? null,
    episodeId: input.episodeId ?? null,
    signal,
    value,
    observedAt: input.observedAt ?? now(),
    source: String(input.source ?? "analytics").trim(),
    note: String(input.note ?? "").trim()
  };
}

export function summarizeQuirkOutcomes(outcomes=[]) {
  const summary = {};
  for (const outcome of Array.isArray(outcomes) ? outcomes : []) {
    if (!QUIRK_OUTCOME_SIGNALS.includes(outcome?.signal)) continue;
    const key = outcome.signal;
    summary[key] = (summary[key] ?? 0) + (Number(outcome.value) || 0);
  }
  return summary;
}

export function suggestQuirks(input={}) {
  const sourceRefs = Array.isArray(input.sourceRefs) ? input.sourceRefs : [];
  const canon = Array.isArray(input.canonThreads) ? input.canonThreads : [];
  const count = Math.max(1, Math.min(Number(input.count) || 3, SPARKS.length));
  return SPARKS.slice(0, count).map((spark, i) => createQuirk({
    ...spark,
    sourceRefs,
    type: i % 2 === 0 ? "story-spark" : "visual-prompt"
  })).map(x => ({...x, canonHint: canon[i % Math.max(1, canon.length)] ?? null}));
}

export function auditQuirks(quirks=[]) {
  const blockers = [];
  for (const quirk of quirks) {
    if (!QUIRK_TYPES.includes(quirk.type)) blockers.push({code:"unknown-quirk-type", id:quirk.id});
    if (!quirk.optional) blockers.push({code:"quirk-not-optional", id:quirk.id});
    if (!String(quirk.title ?? "").trim()) blockers.push({code:"quirk-title-missing", id:quirk.id});
    if ((quirk.expectedSignals ?? []).some(x => !QUIRK_OUTCOME_SIGNALS.includes(x))) blockers.push({code:"unknown-quirk-outcome-signal", id:quirk.id});
  }
  return { ready: blockers.length === 0, blockers, count: quirks.length };
}
