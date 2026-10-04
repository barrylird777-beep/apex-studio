import { readFile } from 'node:fs/promises';
import { validateHookPlan, validateTimeline } from '../src/video/hook.mjs';
import { assembleVideo, probeVideo, checkSpec } from '../src/video/assemble.mjs';

const argv = process.argv.slice(2);
const planFile = argv.find((arg) => !arg.startsWith('--'));
const flag = (name) => argv.includes(name);
const val = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

if (!planFile) {
  console.error('usage: video-make.mjs plan.json --out file.mp4 [--hook-only] [--no-subs]');
  process.exit(2);
}

const plan = JSON.parse(await readFile(planFile, 'utf8'));
const outPath = val('--out') ?? 'out/video.mp4';

if (flag('--hook-only')) {
  const result = validateHookPlan(plan);
  if (!result.ok) {
    console.error('HOOK INVALID:\n- ' + result.errors.join('\n- '));
    process.exit(1);
  }
}

if (plan.narrationDurationSec !== undefined) {
  const timeline = validateTimeline(
    plan.shots,
    plan.narrationDurationSec,
    0.5,
    plan.narrationStartSec ?? 0,
  );
  if (!timeline.ok) {
    console.error('TIMELINE INVALID:\n- ' + timeline.errors.join('\n- '));
    process.exit(1);
  }
}

const result = await assembleVideo({
  shots: plan.shots,
  narration: plan.narration,
  music: plan.music ?? null,
  outPath,
  subtitles: !flag('--no-subs'),
  narrationStartSec: plan.narrationStartSec ?? 0,
});

const probe = await probeVideo(result.outPath);
const spec = checkSpec(probe, { expectedSec: result.durationSec });
console.log(JSON.stringify({ outPath: result.outPath, srt: result.srtPath, probe, spec }, null, 2));
process.exit(spec.ok ? 0 : 1);
