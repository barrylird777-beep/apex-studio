export const STYLE_BLOCK =
  'dark fantasy anime, sharp cel shading, cinematic lighting, high contrast, ' +
  'intense, highly detailed, 16:9 widescreen, cinematic Bible storytelling';

export const LABELS = ['scripture', 'tradition', 'scholarly', 'dramatization', 'original'];

export const HOOK_RULES = {
  minTotalSec: 27,
  maxTotalSec: 33,
  minShotSec: 2,
  maxShotSec: 4,
  maxFirstLineWords: 8,
  maxNarrationStartSec: 1,
};

const BANNED_OPENERS = [
  /^\s*in this video/i,
  /^\s*welcome/i,
  /^\s*today\b/i,
  /^\s*have you ever wondered/i,
];
const MOTIONS = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'];

export function validateHookPlan(plan, rules = HOOK_RULES) {
  const errors = [];
  const shots = plan?.shots;
  if (!Array.isArray(shots) || shots.length === 0) {
    return { ok: false, errors: ['no shots'], totalSec: 0 };
  }

  const totalSec = shots.reduce((sum, shot) => sum + (Number(shot.durationSec) || 0), 0);
  if (totalSec < rules.minTotalSec || totalSec > rules.maxTotalSec) {
    errors.push(`total ${totalSec.toFixed(2)}s outside ${rules.minTotalSec}-${rules.maxTotalSec}s`);
  }

  shots.forEach((shot, index) => {
    const tag = `shot ${shot.id ?? index}`;
    if (!(Number(shot.durationSec) >= rules.minShotSec && Number(shot.durationSec) <= rules.maxShotSec)) {
      errors.push(`${tag}: duration ${shot.durationSec}s outside ${rules.minShotSec}-${rules.maxShotSec}s`);
    }
    if (!MOTIONS.includes(shot.motion)) {
      errors.push(`${tag}: motion "${shot.motion}" not one of ${MOTIONS.join(', ')}`);
    }
    if (!Array.isArray(shot.sources) || shot.sources.length === 0) {
      errors.push(`${tag}: missing sources (provenance)`);
    }
    if (!Array.isArray(shot.labels) || shot.labels.length === 0 || shot.labels.some((label) => !LABELS.includes(label))) {
      errors.push(`${tag}: labels must be a non-empty subset of ${LABELS.join(', ')}`);
    }
    if (typeof shot.visual !== 'string' || !shot.visual.trim()) {
      errors.push(`${tag}: missing visual description`);
    }
  });

  if (shots[0].kind !== 'scene') errors.push('first shot must be a scene (no logo/title card)');

  const narrationStartSec = Number(plan.narrationStartSec);
  if (!Number.isFinite(narrationStartSec) || narrationStartSec < 0 || narrationStartSec > rules.maxNarrationStartSec) {
    errors.push(`narration must start within ${rules.maxNarrationStartSec}s`);
  }

  const first = (shots.find((shot) => typeof shot.narration === 'string' && shot.narration.trim())?.narration ?? '').trim();
  if (!first) {
    errors.push('no narration line');
  } else {
    const words = first.split(/\s+/).length;
    if (words > rules.maxFirstLineWords) errors.push(`first line is ${words} words (max ${rules.maxFirstLineWords})`);
    if (BANNED_OPENERS.some((re) => re.test(first))) errors.push('first line uses a throat-clearing opener');
  }

  return { ok: errors.length === 0, errors, totalSec };
}

export function validateTimeline(shots, audioDurationSec, slackSec = 0.5, narrationStartSec = 0) {
  if (!Array.isArray(shots) || shots.length === 0) return { ok: false, errors: ['no shots'], totalSec: 0 };
  const totalSec = shots.reduce((sum, shot) => sum + Number(shot.durationSec), 0);
  const errors = [];
  const audioEndSec = Number(narrationStartSec) + Number(audioDurationSec);
  if (!Number.isFinite(audioEndSec) || audioEndSec > totalSec + slackSec) {
    errors.push(`narration ends at ${audioEndSec.toFixed(2)}s, later than video ${totalSec.toFixed(2)}s`);
  }
  return { ok: errors.length === 0, errors, totalSec };
}

export function buildShotPrompt({ shot, visualBible = {}, styleBlock = STYLE_BLOCK }) {
  const chars = (shot.characters ?? []).map((name) => {
    const entry = visualBible[name];
    return entry ? `${name}: ${entry}` : name;
  });
  return [
    String(shot.visual ?? '').trim().replace(/[.\s]+$/, ''),
    chars.length ? `Characters: ${chars.join('; ')}` : null,
    styleBlock,
  ].filter(Boolean).join('. ');
}
