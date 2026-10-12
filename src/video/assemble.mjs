import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, rename, rm, mkdir, access } from 'node:fs/promises';
import path from 'node:path';

const execAsync = promisify(execFile);
export const FPS = 30, WIDTH = 1920, HEIGHT = 1080;
export function motionFilter(motion, frames) {
  const n = Math.max(1, frames - 1), cx = "x='iw/2-(iw/zoom/2)'", cy = "y='ih/2-(ih/zoom/2)'", tail = `d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS}`;
  switch (motion) {
    case 'zoom_in': return `zoompan=z='min(1+0.25*on/${n},1.25)':${cx}:${cy}:${tail}`;
    case 'zoom_out': return `zoompan=z='max(1.25-0.25*on/${n},1)':${cx}:${cy}:${tail}`;
    case 'pan_left': return `zoompan=z='1.2':x='(iw-iw/zoom)*(1-on/${n})':${cy}:${tail}`;
    case 'pan_right': return `zoompan=z='1.2':x='(iw-iw/zoom)*(on/${n})':${cy}:${tail}`;
    default: throw new Error(`unknown motion "${motion}"`);
  }
}
export function buildFilterGraph(shots, { narIdx, musicIdx = null }) {
  const chains = shots.map((s, i) => {
    const frames = Math.round(s.durationSec * FPS);
    return `[${i}:v]scale=2880:1620:force_original_aspect_ratio=increase,crop=2880:1620,setsar=1,${motionFilter(s.motion, frames)},format=yuv420p[v${i}]`;
  });
  chains.push(`${shots.map((_, i) => `[v${i}]`).join('')}concat=n=${shots.length}:v=1:a=0[v]`);
  const std = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  if (musicIdx === null) chains.push(`[${narIdx}:a]${std}[a]`);
  else { chains.push(`[${narIdx}:a]${std}[n]`); chains.push(`[${musicIdx}:a]${std},aloop=loop=-1:size=2147483647,volume=0.25[m]`); chains.push('[n][m]amix=inputs=2:duration=first:dropout_transition=0,volume=1.8[a]'); }
  return chains.join(';');
}
const ts = (sec) => { const ms = Math.round(sec * 1000), p = (n, w = 2) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
export function buildSrt(shots) { let t = 0, n = 0; const out = []; for (const s of shots) { const start = t; t += s.durationSec; const text = (s.narration ?? '').trim(); if (!text) continue; out.push(`${++n}\n${ts(start)} --> ${ts(t)}\n${text}\n`); } return out.join('\n'); }
export function buildFfmpegArgs({ shots, narration, music = null, tmpOut }) {
  const narIdx = shots.length, musicIdx = music ? narIdx + 1 : null, total = shots.reduce((a, s) => a + s.durationSec, 0);
  return ['-y','-hide_banner','-loglevel','error',...shots.flatMap((s) => ['-i', s.image]),'-i',narration,...(music ? ['-i',music] : []),'-filter_complex',buildFilterGraph(shots,{narIdx,musicIdx}),'-map','[v]','-map','[a]','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-r',String(FPS),'-c:a','aac','-b:a','192k','-t',total.toFixed(3),'-movflags','+faststart','-f','mp4',tmpOut];
}
const has = async (p) => { try { await access(p); return true; } catch { return false; } };
export async function assembleVideo({ shots, narration, music = null, outPath, ffmpegPath = 'ffmpeg', exec = execAsync }) {
  if (!Array.isArray(shots) || shots.length === 0) throw new Error('assemble: no shots');
  for (const s of shots) { if (!s.image || !(await has(s.image))) throw new Error(`assemble: shot ${s.id} has no image file`); if (!Number.isFinite(s.durationSec) || s.durationSec <= 0) throw new Error(`assemble: shot ${s.id} has a bad duration`); }
  if (!narration || !(await has(narration))) throw new Error('assemble: narration file missing');
  if (music && !(await has(music))) throw new Error('assemble: music file missing');
  await mkdir(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.${process.pid}.${Date.now()}.tmp`;
  try { await exec(ffmpegPath, buildFfmpegArgs({ shots, narration, music, tmpOut: tmp }), { maxBuffer: 64 * 1024 * 1024 }); await rename(tmp, outPath); }
  catch (e) { await rm(tmp, { force: true }); throw new Error(`ffmpeg failed: ${String(e.stderr ?? e.message ?? e).split('\n').slice(-6).join('\n')}`); }
  const srtPath = outPath.replace(/\.[^.]+$/, '') + '.srt', srtTmp = `${srtPath}.${process.pid}.tmp`;
  await writeFile(srtTmp, buildSrt(shots)); await rename(srtTmp, srtPath);
  return { outPath, srtPath, durationSec: shots.reduce((a, s) => a + s.durationSec, 0) };
}
export async function probeVideo(file, { ffprobePath = 'ffprobe', exec = execAsync } = {}) {
  const { stdout } = await exec(ffprobePath, ['-v','error','-print_format','json','-show_streams','-show_format',file], { maxBuffer: 16 * 1024 * 1024 });
  const j = JSON.parse(stdout), v = (j.streams ?? []).find((s) => s.codec_type === 'video'), a = (j.streams ?? []).find((s) => s.codec_type === 'audio');
  return { width:v?.width ?? null,height:v?.height ?? null,vcodec:v?.codec_name ?? null,pixFmt:v?.pix_fmt ?? null,acodec:a?.codec_name ?? null,durationSec:Number(j.format?.duration ?? v?.duration ?? NaN) };
}
export function checkSpec(p, { expectedSec, toleranceSec = 0.5 } = {}) {
  const errors = [];
  if (p.width !== WIDTH || p.height !== HEIGHT) errors.push(`resolution ${p.width}x${p.height}, need ${WIDTH}x${HEIGHT}`);
  if (p.vcodec !== 'h264') errors.push(`video codec ${p.vcodec}, need h264`);
  if (p.acodec !== 'aac') errors.push(`audio codec ${p.acodec}, need aac`);
  if (p.pixFmt !== 'yuv420p') errors.push(`pixel format ${p.pixFmt}, need yuv420p`);
  if (expectedSec !== undefined && (!Number.isFinite(p.durationSec) || Math.abs(p.durationSec - expectedSec) > toleranceSec)) errors.push(`duration ${p.durationSec}s, expected ${expectedSec}s +/- ${toleranceSec}s`);
  return { ok: errors.length === 0, errors };
}
