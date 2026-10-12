import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

const MIN_RESTART_MS = 250;
const DEFAULT_WATCHDOG_MS = 250;
const TS_PACKET = 188;

function required(value, name) {
  if (!value) throw new TypeError(`${name} is required`);
}

function sourceArgs(source) {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', '+genpts+nobuffer',
    '-i', source,
    '-map', '0:v:0?',
    '-map', '0:a:0?',
    '-c', 'copy',
    '-f', 'mpegts',
    'pipe:1'
  ];
}

function egressArgs(dest, transcode) {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-fflags', '+genpts+nobuffer',
    '-f', 'mpegts',
    '-i', 'pipe:0',
    ...(transcode
      ? [
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-tune', 'zerolatency',
          '-pix_fmt', 'yuv420p',
          '-b:v', '4500k',
          '-maxrate', '5000k',
          '-bufsize', '9000k',
          '-g', '60',
          '-bf', '0',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-ar', '48000',
          '-ac', '2'
        ]
      : ['-c:v', 'copy', '-c:a', 'copy']),
    '-f', 'flv',
    '-flvflags', 'no_duration_filesize',
    dest
  ];
}

export function buildZeroStopSourceArgs(source) {
  required(source, 'source');
  return sourceArgs(source);
}

export function buildZeroStopEgressArgs({ dest, transcode = false } = {}) {
  required(dest, 'destination endpoint');
  return egressArgs(dest, Boolean(transcode));
}

export function createZeroStopRelay({
  ingestSource = '',
  destEndpoint,
  fallbackSource,
  ffmpegPath = 'ffmpeg',
  watchdogMs = DEFAULT_WATCHDOG_MS,
  reconnectMs = 1000,
  transcode = false,
  autoStart = false
} = {}) {
  required(destEndpoint, 'destination endpoint');
  required(fallbackSource, 'fallback source');

  const state = {
    status: 'idle',
    activeSource: 'fallback',
    egressPid: null,
    sourcePid: null,
    egressStarts: 0,
    sourceStarts: 0,
    switches: 0,
    lastSourceAt: null,
    lastError: null,
    startedAt: null
  };

  let egress = null;
  let source = null;
  let liveCandidate = null;
  let stopping = false;
  let sourceTimer = null;
  let watchdog = null;
  let lastSourceDataAt = 0;
  let sourceBuffer = Buffer.alloc(0);
  let sourceMode = 'fallback';
  let startPromise = null;

  const retryDelay = () => Math.max(MIN_RESTART_MS, Number(reconnectMs) || 1000);
  const watchDelay = () => Math.max(50, Number(watchdogMs) || DEFAULT_WATCHDOG_MS);

  const clearTimers = () => {
    if (sourceTimer) clearTimeout(sourceTimer);
    if (watchdog) clearInterval(watchdog);
    sourceTimer = null;
    watchdog = null;
  };

  const rememberError = error => {
    state.lastError = String(error?.message || error).slice(-2000);
  };

  const kill = child => {
    if (child && !child.killed) child.kill('SIGTERM');
  };

  const writeTs = chunk => {
    if (!egress?.stdin?.writable || !chunk?.length) return;
    sourceBuffer = Buffer.concat([sourceBuffer, chunk]);
    const usable = sourceBuffer.length - (sourceBuffer.length % TS_PACKET);
    if (usable <= 0) return;
    const packets = sourceBuffer.subarray(0, usable);
    sourceBuffer = sourceBuffer.subarray(usable);
    try {
      egress.stdin.write(packets);
    } catch (error) {
      rememberError(error);
    }
  };

  const stopSource = () => {
    kill(source);
    kill(liveCandidate);
    source = null;
    liveCandidate = null;
    state.sourcePid = null;
    sourceBuffer = Buffer.alloc(0);
  };

  const scheduleLiveProbe = () => {
    if (stopping || !ingestSource || sourceMode !== 'fallback' || liveCandidate || sourceTimer) return;
    sourceTimer = setTimeout(() => {
      sourceTimer = null;
      probeLive();
    }, retryDelay());
    sourceTimer.unref?.();
  };

  const scheduleSource = mode => {
    if (stopping || sourceTimer) return;
    sourceTimer = setTimeout(() => {
      sourceTimer = null;
      startSource(mode);
    }, retryDelay());
    sourceTimer.unref?.();
  };

  const attachSource = (child, mode) => {
    source = child;
    liveCandidate = null;
    sourceMode = mode;
    state.sourcePid = child.pid ?? null;
    state.activeSource = mode;
    lastSourceDataAt = Date.now();

    child.stdout.on('data', chunk => {
      lastSourceDataAt = Date.now();
      state.lastSourceAt = new Date().toISOString();
      writeTs(chunk);
    });

    child.stderr.on('data', chunk => {
      const message = String(chunk).trim();
      if (/error|failed|invalid|refused|broken pipe/i.test(message)) rememberError(message);
    });

    child.once('error', rememberError);
    child.once('exit', () => {
      if (source !== child) return;
      source = null;
      state.sourcePid = null;
      if (!stopping) scheduleSource(sourceMode);
    });
  };

  const startSource = mode => {
    if (stopping || !egress?.stdin?.writable) return;

    kill(source);
    source = null;

    const selectedMode = mode === 'live' && ingestSource ? 'live' : 'fallback';
    const input = selectedMode === 'live' ? ingestSource : fallbackSource;
    const child = spawn(ffmpegPath, sourceArgs(input), {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    state.sourceStarts++;
    attachSource(child, selectedMode);
  };

  const promoteLiveCandidate = (child, firstChunk) => {
    if (stopping || sourceMode !== 'fallback' || liveCandidate !== child) return;
    state.switches++;
    kill(source);
    source = null;
    attachSource(child, 'live');
    writeTs(firstChunk);
  };

  const probeLive = () => {
    if (stopping || !ingestSource || sourceMode !== 'fallback' || liveCandidate) return;

    const child = spawn(ffmpegPath, sourceArgs(ingestSource), {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    liveCandidate = child;
    state.sourceStarts++;

    let promoted = false;

    child.stdout.on('data', chunk => {
      if (promoted || stopping || sourceMode !== 'fallback') return;
      promoted = true;
      promoteLiveCandidate(child, chunk);
    });

    child.stderr.on('data', chunk => {
      const message = String(chunk).trim();
      if (/error|failed|invalid|refused|broken pipe/i.test(message)) rememberError(message);
    });

    child.once('error', rememberError);
    child.once('exit', () => {
      if (liveCandidate === child) liveCandidate = null;
      if (!promoted && !stopping) scheduleLiveProbe();
    });
  };

  const switchToFallback = () => {
    if (stopping || sourceMode === 'fallback') return;
    state.switches++;
    kill(source);
    source = null;
    state.sourcePid = null;
    startSource('fallback');
  };

  const start = async () => {
    if (startPromise) return startPromise;

    startPromise = (async () => {
      stopping = false;

      const fallbackAccessible = await access(fallbackSource).then(() => true).catch(() => false);
      if (!fallbackAccessible) {
        throw new Error(`fallback source is not accessible: ${fallbackSource}`);
      }

      if (egress) return status();

      state.status = 'starting';
      state.startedAt ||= new Date().toISOString();

      egress = spawn(ffmpegPath, egressArgs(destEndpoint, transcode), {
        stdio: ['pipe', 'ignore', 'pipe']
      });

      state.egressPid = egress.pid ?? null;
      state.egressStarts++;

      egress.stderr.on('data', chunk => {
        const message = String(chunk).trim();
        if (/error|failed|refused|broken pipe|invalid/i.test(message)) rememberError(message);
      });

      egress.once('error', rememberError);
      egress.once('exit', (code, signal) => {
        state.egressPid = null;
        egress = null;
        stopSource();
        if (stopping) return;
        state.status = 'egress-restarting';
        state.lastError = `egress exited code=${code ?? 'null'} signal=${signal ?? 'null'}`;
        setTimeout(() => { void start().catch(rememberError); }, retryDelay()).unref?.();
      });

      state.status = 'running';
      startSource('fallback');

      watchdog = setInterval(() => {
        if (stopping || !egress) return;

        const stale = Date.now() - lastSourceDataAt > watchDelay();

        if (sourceMode === 'live' && stale) {
          switchToFallback();
          return;
        }

        if (sourceMode === 'fallback' && ingestSource) {
          probeLive();
        }
      }, watchDelay());

      watchdog.unref?.();

      return status();
    })().finally(() => {
      startPromise = null;
    });

    return startPromise;
  };

  const stop = () => {
    stopping = true;
    clearTimers();
    stopSource();
    kill(egress);
    egress = null;
    state.egressPid = null;
    state.sourcePid = null;
    state.status = 'stopped';
    return status();
  };

  const status = () => ({
    ...state,
    configured: Boolean(destEndpoint && fallbackSource),
    ingestConfigured: Boolean(ingestSource),
    persistentEgress: true,
    fallbackConfigured: Boolean(fallbackSource),
    transcode: Boolean(transcode)
  });

  if (autoStart) void start().catch(rememberError);

  return { start, stop, status };
}
