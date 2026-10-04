import { readFile } from 'node:fs/promises';
import { createGemini } from '../src/video/gemini.mjs';
import { produceFromRef } from '../src/video/pipeline.mjs';

const argv = process.argv.slice(2);
const value = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const ref = value('--ref');
const outDir = value('--out');
if (!ref || !outDir) {
  console.error('usage: video-from-ref.mjs --ref "<ref>" --out dir [--visual-bible file] [--music file] [--voice name]');
  process.exit(2);
}

const visualBibleFile = value('--visual-bible');
const visualBible = visualBibleFile ? JSON.parse(await readFile(visualBibleFile, 'utf8')) : {};
const result = await produceFromRef({
  ref,
  outDir,
  visualBible,
  gemini: createGemini(),
  music: value('--music') ?? null,
  voice: value('--voice') ?? 'Charon',
  log: (message) => console.error(`[video] ${message}`),
});
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.spec.ok ? 0 : 1;
