import { execFile as ef } from 'node:child_process';
import { promisify as pf } from 'node:util';
import { mkdtempSync as mktmp } from 'node:fs';
import { tmpdir as tdir } from 'node:os';
import path2 from 'node:path';
import { produceFromRef } from '../src/video/pipeline.mjs';
import { assertPublishable } from '../src/video/publish.mjs';
import { createMemoryLedger } from '../src/video/ledger.mjs';

const exec2 = pf(ef);
const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out') >= 0 ? argv[argv.indexOf('--out') + 1] : null;
const outDir = outArg ?? mktmp(path2.join(tdir(), 'apex-smoke-'));

const MO = ['zoom_in', 'zoom_out', 'pan_left', 'pan_right'];
const CL = ['0x8b0000', '0x1a1a40', '0x2f4f2f', '0x4b3621', '0x202020'];
const responses = [
  { events: [
    { id: 'e1', summary: 'Joseph is favored by Jacob.', sources: ['Gen 37:3-4'], label: 'scripture', characters: ['Joseph'] },
    { id: 'e2', summary: 'His brothers sell him.', sources: ['Gen 37:28'], label: 'scripture', characters: ['Joseph'] },
  ] },
  { title: 'The Pit', shots: Array.from({ length: 10 }, (_, i) => ({
    durationSec: 3, motion: MO[i % 4], visual: `Frame ${i}`, characters: ['Joseph'],
    narration: i === 0 ? 'His brothers wanted him gone.' : `Line ${i}.`,
    labels: ['dramatization'], sources: ['Gen 37:3-4'],
  })) },
];
let imgN = 0;
const gemini = {
  models: { text: 'smoke-text', image: 'smoke-image', tts: 'smoke-tts' },
  async generateJson() { return structuredClone(responses.shift()); },
  async generateImage() {
    const { stdout } = await exec2('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${CL[imgN++ % CL.length]}:s=1920x1080`,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-',
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 });
    return { buffer: stdout, mimeType: 'image/png' };
  },
  async generateSpeech() {
    const n = 24000 * 2, b = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 330 * i) / 24000) * 6000), i * 2);
    return { pcm: b, sampleRate: 24000 };
  },
};

const ledger = createMemoryLedger();
console.error(`[smoke] output: ${outDir}`);
const result = await produceFromRef({ ref: 'Genesis 37', outDir, gemini, ledger, log: (m) => console.error(`[smoke] ${m}`) });
console.error(`[smoke] spec: ${JSON.stringify(result.spec)}`);
const gate = await assertPublishable({ dir: outDir, ledger });
console.log(JSON.stringify({ video: result.videoPath, spec: result.spec, gate }, null, 2));
process.exit(result.spec.ok && gate.ok !== false ? 0 : 1);