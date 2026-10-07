import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_INTERVAL_MS = 1500;

export function buildRtmpFfmpegArgs({ input, rtmpUrl, loop = true } = {}) {
  if (!input) throw new TypeError('broadcast input is required');
  if (!rtmpUrl) throw new TypeError('RTMP destination is required');
  return [
    '-re',
    ...(loop ? ['-stream_loop', '-1'] : []),
    '-i', input,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-pix_fmt', 'yuv420p',
    '-r', '24',
    '-b:v', '4500k',
    '-maxrate', '5000k',
    '-bufsize', '9000k',
    '-c:a', 'aac',
    '-b:a', '320k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'flv',
    rtmpUrl
  ];
}

export function createInfiniteBroadcast({ inputDir, rtmpUrl, ffmpegPath = 'ffmpeg', intervalMs = DEFAULT_INTERVAL_MS } = {}) {
  const state = {
    status: 'idle',
    startedAt: null,
    lastStartedAt: null,
    lastExitCode: null,
    lastError: null,
    cycles: 0,
    pid: null
  };
  let child = null;
  let stopping = false;

  async function findInput() {
    if (!inputDir) return null;
    const entries = await fs.readdir(inputDir, { withFileTypes: true }).catch(() => []);
    const candidates = entries
      .filter(entry => entry.isFile() && /\.(mp4|mov|m4v|mkv|webm)$/i.test(entry.name))
      .map(entry => path.join(inputDir, entry.name))
      .sort();
    return candidates[0] || null;
  }

  async function cycle() {
    if (stopping || child) return;
    const input = await findInput();
    if (!input || !rtmpUrl) {
      state.status = rtmpUrl ? 'waiting-for-media' : 'disabled';
      return;
    }

    state.status = 'broadcasting';
    state.lastStartedAt = new Date().toISOString();
    state.startedAt ||= state.lastStartedAt;
    state.lastError = null;

    child = spawn(ffmpegPath, buildRtmpFfmpegArgs({ input, rtmpUrl, loop: true }), {
      stdio: ['ignore', 'ignore', 'pipe']
    });
    state.pid = child.pid ?? null;

    child.stderr.on('data', chunk => {
      const message = String(chunk).trim();
      if (/error|failed|connection refused|broken pipe/i.test(message)) state.lastError = message.slice(-1000);
    });
    child.once('exit', (code, signal) => {
      state.lastExitCode = code;
      state.pid = null;
      child = null;
      state.cycles += 1;
      state.status = stopping ? 'stopped' : 'restarting';
      if (!stopping) setTimeout(() => void cycle(), Math.max(250, Number(intervalMs) || DEFAULT_INTERVAL_MS)).unref?.();
    });
  }

  return {
    async start() { stopping = false; await cycle(); return status(); },
    async stop() {
      stopping = true;
      if (child) child.kill('SIGTERM');
      state.status = 'stopped';
      return status();
    },
    status() { return { ...state, configured: Boolean(rtmpUrl && inputDir) }; }
  };
}
