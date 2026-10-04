import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { generationId } from './identity.mjs';
import { buildShotPrompt, validateHookPlan, HOOK_RULES } from './hook.mjs';
import { assembleVideo, probeVideo, checkSpec } from './assemble.mjs';
import { generateHookPlan } from './script.mjs';
import { pcmToWav, parseWav, durationOfPcm, BYTES_PER_SAMPLE } from './wav.mjs';
import { cachedFile, contentId, atomicWrite } from './cache.mjs';

export function fitDurations(shots, clips, rate, rules = HOOK_RULES) {
  for (let i = 0; i < shots.length; i += 1) {
    const clip = clips[i];
    if (!clip) continue;
    const need = Math.ceil((durationOfPcm(clip, rate) + 0.15) * 10) / 10;
    const duration = Math.max(Number(shots[i].durationSec), need);
    if (duration > rules.maxShotSec) {
      throw new Error(`shot ${shots[i].id}: narration needs ${duration.toFixed(1)}s, over the ${rules.maxShotSec}s shot limit`);
    }
    shots[i].durationSec = duration;
  }
  return shots;
}

export function buildNarrationTrack(shots, clips, rate) {
  if (!Number.isInteger(rate) || rate <= 0) throw new Error('invalid narration sample rate');
  const chunks = shots.map((shot, index) => {
    const bytes = Math.round(Number(shot.durationSec) * rate) * BYTES_PER_SAMPLE;
    const chunk = Buffer.alloc(bytes);
    const clip = clips[index];
    if (clip) clip.copy(chunk, 0, 0, Math.min(clip.length, bytes));
    return chunk;
  });
  return Buffer.concat(chunks);
}

function imageExt(mimeType) {
  const mime = String(mimeType).toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  return 'png';
}

async function loadCachedAudio(file) {
  const data = await readFile(file);
  const parsed = parseWav(data);
  return parsed;
}

export async function produceHook({
  ref, events, visualBible = {}, outDir, gemini, music = null, voice = 'Charon',
  assemble = assembleVideo, probe = probeVideo, log = () => {},
}) {
  if (!gemini?.models || typeof gemini.generateJson !== 'function' || typeof gemini.generateImage !== 'function' || typeof gemini.generateSpeech !== 'function') {
    throw new Error('produceHook: invalid Gemini/provider client');
  }
  const dir = path.resolve(outDir);
  await mkdir(dir, { recursive: true });

  log('plan: generating and validating hook plan');
  const plan = await generateHookPlan({ gemini, ref, events, visualBible });

  log('narration: synthesizing per-shot speech');
  const clips = [];
  let rate = null;
  for (const shot of plan.shots) {
    const id = contentId({
      kind: 'tts', ref, model: gemini.models.tts, voice, text: shot.narration, version: 'tts-v2',
    });
    const file = await cachedFile({
      dir: path.join(dir, 'audio'),
      id,
      exts: ['wav'],
      make: async () => {
        const audio = await gemini.generateSpeech(shot.narration, { voice });
        if (!Number.isInteger(audio.sampleRate) || audio.sampleRate <= 0 || !Buffer.isBuffer(audio.pcm)) {
          throw new Error(`TTS provider returned invalid PCM for shot ${shot.id}`);
        }
        return { buffer: pcmToWav(audio.pcm, audio.sampleRate), ext: 'wav' };
      },
    });
    const audio = await loadCachedAudio(file.path);
    if (rate === null) rate = audio.sampleRate;
    if (audio.sampleRate !== rate) {
      throw new Error(`shot ${shot.id}: cached/provider sample rate ${audio.sampleRate} differs from ${rate}`);
    }
    clips.push(audio.pcm);
  }

  fitDurations(plan.shots, clips, rate);
  const validation = validateHookPlan(plan);
  if (!validation.ok) throw new Error(`hook invalid after fitting narration:\n- ${validation.errors.join('\n- ')}`);

  const narrationPath = path.join(dir, 'narration.wav');
  const narrationPcm = buildNarrationTrack(plan.shots, clips, rate);
  await atomicWrite(narrationPath, pcmToWav(narrationPcm, rate));
  plan.narration = narrationPath;
  plan.narrationDurationSec = durationOfPcm(narrationPcm, rate);

  log('images: generating per-shot images');
  for (const shot of plan.shots) {
    const prompt = buildShotPrompt({ shot, visualBible });
    const id = generationId({
      project: ref, model: gemini.models.image, prompt, width: 1920, height: 1080, seed: 0, version: 'img-v2',
    });
    const file = await cachedFile({
      dir: path.join(dir, 'images'),
      id,
      exts: ['png', 'jpg', 'webp'],
      make: async () => {
        const image = await gemini.generateImage(prompt);
        return { buffer: image.buffer, ext: imageExt(image.mimeType) };
      },
    });
    shot.image = file.path;
    shot.imageId = id;
  }

  plan.music = music;
  const planPath = path.join(dir, 'plan.json');
  await atomicWrite(planPath, JSON.stringify(plan, null, 2));

  log('render: assembling final MP4');
  const videoPath = path.join(dir, 'hook.mp4');
  const assembled = await assemble({
    shots: plan.shots,
    narration: narrationPath,
    music,
    outPath: videoPath,
    narrationStartSec: plan.narrationStartSec,
  });
  const probeResult = await probe(assembled.outPath);
  const spec = checkSpec(probeResult, { expectedSec: validation.totalSec });
  return { videoPath: assembled.outPath, srtPath: assembled.srtPath ?? null, planPath, probe: probeResult, spec };
}
