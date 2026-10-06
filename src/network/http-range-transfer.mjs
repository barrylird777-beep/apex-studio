import fs from "node:fs/promises";
import path from "node:path";

function parseRange(value) {
  const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(String(value || ""));
  return m ? { start: Number(m[1]), end: Number(m[2]), total: Number(m[3]) } : null;
}

export async function probeHttpRange(url, { signal, timeoutMs = 30000 } = {}) {
  const response = await fetch(url, { headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" }, signal: transferAbort.signal });
  const range = parseRange(response.headers.get("content-range"));
  await response.body?.cancel();
  return Object.freeze({ supported: response.status === 206 && Boolean(range), totalBytes: range?.total || null, validator: response.headers.get("etag") || response.headers.get("last-modified") || null });
}

export async function downloadHttpAsset(url, destinationPath, { parallelStreams = 4, chunkMiB = 16, retryLimit = 4, signal, onProgress, transferController } = {}) {
  const probe = await probeHttpRange(url, { signal });
  if (!probe.supported || !probe.totalBytes) {
    const error = new Error("SOURCE_NO_RANGE_SUPPORT");
    error.code = "SOURCE_NO_RANGE_SUPPORT";
    throw error;
  }
  const total = probe.totalBytes;
  const started = performance.now();
  const size = Math.max(1, Math.min(64, Number(chunkMiB) || 16)) * 1024 * 1024;
  const ranges = [];
  for (let start = 0; start < total; start += size) ranges.push({ start, end: Math.min(total - 1, start + size - 1) });
  await fs.mkdir(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
  const handle = await fs.open(destinationPath, "w+", 0o600);
  await handle.truncate(total);
  let cursor = 0, completed = 0;
  const workers = Math.max(1, Math.min(16, Number(parallelStreams) || 4));
  const transferAbort = new AbortController();
  signal?.addEventListener('abort', () => transferAbort.abort(signal.reason), { once: true });
  const controller = transferController || null;
  const getRange = async (range) => {
    let last;
    for (let attempt = 0; attempt <= retryLimit; attempt++) {
      try {
        const headers = { Range: `bytes=${range.start}-${range.end}`, "Accept-Encoding": "identity" };
        if (probe.validator) headers["If-Range"] = probe.validator;
        const response = await fetch(url, { headers, signal });
        const actual = parseRange(response.headers.get("content-range"));
        if (response.status !== 206 || !actual || actual.start !== range.start || actual.end !== range.end || actual.total !== total) throw new Error("Invalid range response");
        let offset = range.start;
        for await (const chunk of response.body || []) {
          const data = Buffer.from(chunk);
          await handle.write(data, 0, data.length, offset);
          offset += data.length;
        }
        if (offset !== range.end + 1) throw new Error("Range length mismatch");
        return;
      } catch (e) {
        last = e;
        if (attempt < retryLimit) await new Promise(r => setTimeout(r, Math.min(4000, 100 * 2 ** attempt)));
      }
    }
    throw last;
  };
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= ranges.length) return;
      await getRange(ranges[index]);
      completed++;
      const elapsedSeconds = Math.max(0.001, (performance.now() - started) / 1000);
      const completedBytes = Math.min(total, completed === ranges.length ? total : completed * size);
      const observedMbps = completedBytes * 8 / elapsedSeconds / 1e6;
      const state = controller?.observe?.({ observedMbps, lossPct: 0, rttMs: 0 }) || null;
      onProgress?.({ completed, totalRanges: ranges.length, totalBytes: total, observedMbps, controller: state });
    }
  };
  try {
    const activeWorkers = Math.min(workers, ranges.length);
    await Promise.all(Array.from({ length: activeWorkers }, worker));
    await handle.sync();
  } finally {
    await handle.close();
  }
  return Object.freeze({ path: destinationPath, bytes: total, parallelStreams: workers, ranges: ranges.length });
}