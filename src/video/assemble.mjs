import { spawn } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const W = 1920;
export const H = 1080;
export const FPS = 30;
const MOTIONS = new Set(['zoom_in', 'zoom_out', 'pan_left', 'pan_right']);

export function zoompanExpr(motion, frames) {
  const cy = "y='ih/2-(ih/zoom/2)'";
  switch (motion) {
    case 'zoom_in':
      return `z='min(1+0.15*on/${frames},1.15)':x='iw/2-(iw/zoom/2)':${cy}`;
    case 'zoom_out':
      return `z='max(1.15-0.15*on/${frames},1)':x='iw/2-(iw/zoom/2)':${cy}`;
    case 'pan_right':
      return `z='1.12':x='(iw-iw/zoom)*on/${frames}':${cy}`;
    case 'pan_left':
      return `z='1.12':x='(iw-iw/zoom)*(1-on/${frames})':${cy}`;
    default:
      throw new Error(`unknown motion "${motion}"`);
  }
}

const f3 = (n) => Number(n).toFixed(3);

export function buildFilterGraph(shots, { xfade = 0.4, hasMusic = false, narrationIndex, musicIndex, narrationStartSec = 0 } = {}) {
  const n = shots.length;
  const parts = [];

  shots.forEach((shot, index) => {
    const length = shot.durationSec + (index < n - 1 ? xfade : 0);
    const frames = Math.max(1, Math.round(length * FPS));
    parts.push(
      `[${index}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},` +
      `zoompan=${zoompanExpr(shot.motion, frames)}:d=${frames}:s=${W}x${H}:fps=${FPS},setsar=1,format=yuv420p[v${index}]`,
    );
  });

  let last = 'v0';
  let cumulative = 0;
  for (let index = 1; index < n; index += 1) {
    cumulative += Number(shots[index - 1].durationSec);
    const out = index === n - 1 ? 'vfinal' : `x${index}`;
    parts.push(
      `[${last}][v${index}]xfade=transition=fade:duration=${f3(xfade)}:offset=${f3(cumulative)}[${out}]`,
    );
    last = out;
  }
  if (n === 1) parts.push('[v0]null[vfinal]');

  if (hasMusic) {
    parts.push(
      `[${narrationIndex}:a]${Number(narrationStartSec) > 0 ? `adelay=delays=${Math.round(Number(narrationStartSec) * 1000)}:all=1,` : ''}apad,asplit=2[nsc][nmix]`,
      `[${musicIndex}:a]volume=0.5[mus]`,
      '[mus][nsc]sidechaincompress=threshold=0.04:ratio=10:attack=15:release=350[duck]',
      '[nmix][duck]amix=inputs=2:duration=first:dropout_transition=0,volume=2[aout]',
    );
  } else {
    parts.push(`[${narrationIndex}:a]${Number(narrationStartSec) > 0 ? `adelay=delays=${Math.round(Number(narrationStartSec) * 1000)}:all=1,` : ''}apad[aout]`);
  }
  return parts.join(';');
}

const srtTime = (seconds) => {
  const ms = Math.max(0, Math.round(Number(seconds) * 1000));
  const p = (value, length = 2) => String(value).padStart(length, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

export function toSrt(shots, narrationStartSec = 0) {
  let time = Number(narrationStartSec) || 0;
  const cues = [];
  for (const shot of shots) {
    if (typeof shot.narration === 'string' && shot.narration.trim()) {
      cues.push(
        `${cues.length + 1}\n${srtTime(time)} --> ${srtTime(time + Number(shot.durationSec))}\n${shot.narration.trim()}\n`,
      );
    }
    time += Number(shot.durationSec);
  }
  return cues.join('\n');
}

export function buildFfmpegArgs({ shots, narration, music, srtPath, tmpOut, xfade = 0.4, narrationStartSec = 0 }) {
  const n = shots.length;
  const narrationIndex = n;
  const musicIndex = music ? n + 1 : undefined;
  const srtIndex = srtPath ? n + (music ? 2 : 1) : undefined;
  const total = shots.reduce((sum, shot) => sum + Number(shot.durationSec), 0);

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  for (const shot of shots) args.push('-loop', '1', '-i', shot.image);
  if (Number(narrationStartSec) > 0) args.push('-i', narration);
  else args.push('-i', narration);
  if (music) args.push('-stream_loop', '-1', '-i', music);
  if (srtPath) args.push('-i', srtPath);

  args.push(
    '-filter_complex',
    buildFilterGraph(shots, { xfade, hasMusic: Boolean(music), narrationIndex, musicIndex, narrationStartSec }),
    '-map', '[vfinal]',
    '-map', '[aout]',
  );
  if (srtPath) {
    args.push('-map', `${srtIndex}:s`, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng');
  }
  args.push(
    '-t', f3(total),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-movflags', '+faststart', '-f', 'mp4', tmpOut,
  );
  return args;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr.trim().slice(-2000)}`));
    });
  });
}

export async function assembleVideo({
  shots,
  narration,
  music = null,
  outPath,
  xfade = 0.4,
  subtitles = true,
  narrationStartSec = 0,
}) {
  if (!Array.isArray(shots) || shots.length === 0) throw new Error('assembleVideo: no shots');
  if (!(xfade >= 0)) throw new Error('assembleVideo: xfade must be >= 0');
  for (const shot of shots) {
    if (!shot.image) throw new Error(`shot ${shot.id}: missing image path`);
    if (!MOTIONS.has(shot.motion)) throw new Error(`shot ${shot.id}: bad motion "${shot.motion}"`);
    if (!(Number(shot.durationSec) > xfade)) throw new Error(`shot ${shot.id}: durationSec must exceed xfade (${xfade}s)`);
  }
  if (!narration) throw new Error('assembleVideo: narration audio path required');
  if (!outPath) throw new Error('assembleVideo: outPath required');

  await mkdir(path.dirname(outPath), { recursive: true });
  const tmpOut = `${outPath}.${process.pid}.${Date.now()}.tmp`;
  const srtPath = subtitles ? outPath.replace(/\.mp4$/i, '') + '.srt' : null;
  if (srtPath) await writeFile(srtPath, toSrt(shots, narrationStartSec), 'utf8');

  const args = buildFfmpegArgs({
    shots, narration, music, srtPath, tmpOut, xfade, narrationStartSec,
  });
  try {
    await run('ffmpeg', args);
    await rename(tmpOut, outPath);
  } catch (error) {
    await rm(tmpOut, { force: true });
    if (srtPath) await rm(srtPath, { force: true });
    throw error;
  }
  return {
    outPath,
    srtPath,
    durationSec: shots.reduce((sum, shot) => sum + Number(shot.durationSec), 0),
    ffmpegArgs: args,
  };
}

export async function probeVideo(file) {
  const json = JSON.parse(await run('ffprobe', [
    '-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file,
  ]));
  const video = json.streams.find((stream) => stream.codec_type === 'video');
  const audio = json.streams.find((stream) => stream.codec_type === 'audio');
  return {
    width: video?.width,
    height: video?.height,
    pixFmt: video?.pix_fmt,
    vcodec: video?.codec_name,
    acodec: audio?.codec_name,
    durationSec: Number(json.format.duration),
    fps: video?.r_frame_rate,
    subtitleCodec: json.streams.find((stream) => stream.codec_type === 'subtitle')?.codec_name,
  };
}

export function checkSpec(probe, { expectedSec, toleranceSec = 0.7 } = {}) {
  const errors = [];
  if (probe.width !== W || probe.height !== H) errors.push(`resolution ${probe.width}x${probe.height}, expected ${W}x${H}`);
  if (probe.vcodec !== 'h264') errors.push(`video codec ${probe.vcodec}, expected h264`);
  if (probe.acodec !== 'aac') errors.push(`audio codec ${probe.acodec}, expected aac`);
  if (probe.pixFmt !== 'yuv420p') errors.push(`pix_fmt ${probe.pixFmt}, expected yuv420p`);
  if (probe.subtitleCodec && probe.subtitleCodec !== 'mov_text') errors.push(`subtitle codec ${probe.subtitleCodec}, expected mov_text`);
  if (expectedSec !== undefined && Math.abs(probe.durationSec - expectedSec) > toleranceSec) {
    errors.push(`duration ${probe.durationSec.toFixed(2)}s, expected ~${expectedSec}s`);
  }
  return { ok: errors.length === 0, errors };
}
