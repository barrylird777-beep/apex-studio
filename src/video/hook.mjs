import { canonicalStringify as stable } from './identity.mjs';

export const LABELS = ['scripture', 'tradition', 'scholarly', 'dramatization', 'original'];
export const MOTIONS = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'];
export const HOOK_RULES = { minShots: 9, maxShots: 12, minShotSec: 2, maxShotSec: 4, minTotalSec: 28, maxTotalSec: 32, maxFirstLineWords: 8 };
const BAD_OPENERS = /^\s*(in this video|welcome|today|have you ever wondered)\b/i;
const EPS = 1e-9;

export function validateHookPlan(plan, rules = HOOK_RULES) {
  if (!plan || !Array.isArray(plan.shots)) return { ok: false, errors: ['plan has no shots array'], totalSec: 0 };
  const errors = [], { shots } = plan;
  if (shots.length < rules.minShots || shots.length > rules.maxShots) errors.push(`shot count ${shots.length} must be ${rules.minShots}-${rules.maxShots}`);
  let total = 0;
  shots.forEach((s, i) => {
    const at = `shot ${s?.id ?? i}`;
    if (!s || typeof s !== 'object') { errors.push(`${at}: not an object`); return; }
    const d = s.durationSec;
    if (!Number.isFinite(d)) errors.push(`${at}: durationSec is not a number`);
    else { total += d; if (d < rules.minShotSec - EPS || d > rules.maxShotSec + EPS) errors.push(`${at}: duration ${d}s must be ${rules.minShotSec}-${rules.maxShotSec}s`); }
    if (!MOTIONS.includes(s.motion)) errors.push(`${at}: motion must be one of ${MOTIONS.join('|')}`);
    if (typeof s.visual !== 'string' || !s.visual.trim()) errors.push(`${at}: missing visual`);
    if (typeof s.narration !== 'string') errors.push(`${at}: narration must be a string`);
    if (!Array.isArray(s.labels) || s.labels.length === 0 || !s.labels.every((l) => LABELS.includes(l))) errors.push(`${at}: labels must be a non-empty subset of ${LABELS.join('|')}`);
    if (!Array.isArray(s.sources) || s.sources.length === 0 || !s.sources.every((x) => typeof x === 'string' && x.trim())) errors.push(`${at}: needs at least one source`);
  });
  const totalSec = Math.round(total * 10) / 10;
  if (totalSec < rules.minTotalSec - EPS || totalSec > rules.maxTotalSec + EPS) errors.push(`total duration ${totalSec}s must be ${rules.minTotalSec}-${rules.maxTotalSec}s`);
  if (plan.narrationStartSec !== 0) errors.push('narration must start at 0s (shot 1)');
  const first = typeof shots[0]?.narration === 'string' ? shots[0].narration.trim() : '';
  if (!first) errors.push('shot 1 must have narration');
  else { if (first.split(/\s+/).length > rules.maxFirstLineWords) errors.push(`first line is over ${rules.maxFirstLineWords} words`); if (BAD_OPENERS.test(first)) errors.push('first line uses a banned opener'); }
  return { ok: errors.length === 0, errors, totalSec };
}
export const STYLE = ['dark fantasy anime', 'sharp cel shading', 'cinematic lighting', 'high contrast', 'intense detail-heavy imagery', '16:9 cinematic composition'].join(', ');
export function buildShotPrompt({ shot, visualBible = {} }) {
  const chars = (shot.characters ?? []).map((n) => { const d = visualBible[n]; if (d === undefined) return n; return `${n} (${typeof d === 'string' ? d : stable(d)})`; });
  return [`Single cinematic frame for a Bible-story film: ${shot.visual}`, chars.length ? `Characters, keep their look consistent: ${chars.join('; ')}.` : '', `Style: ${STYLE}.`, 'Reverent, serious tone. No text, captions, logos, or watermarks in the image.'].filter(Boolean).join('\n');
}
