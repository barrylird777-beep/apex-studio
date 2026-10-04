import { readFile } from 'node:fs/promises';
import { createGemini } from '../src/video/gemini.mjs';
import { produceHook } from '../src/video/produce.mjs';

const argv = process.argv.slice(2);
const value = (name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const ref = value('--ref');
const eventsFile = value('--events');
const outDir = value('--out');

if (!ref || !eventsFile || !outDir) {
  console.error('usage: video-produce.mjs --ref "<ref>" --events events.json --out dir [--visual-bible f] [--music f] [--voice name]');
  process.exit(2);
}

try {
  const events = JSON.parse(await readFile(eventsFile, 'utf8'));
  const visualBible = value('--visual-bible')
    ? JSON.parse(await readFile(value('--visual-bible'), 'utf8'))
    : {};

  const result = await produceHook({
    ref,
    events,
    visualBible,
    outDir,
    gemini: createGemini(),
    music: value('--music') ?? null,
    voice: value('--voice') ?? 'Charon',
    log: (message) => console.error(`[video] ${message}`),
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.spec.ok ? 0 : 1);
} catch (error) {
  console.error(`[video] ${error?.stack ?? error}`);
  process.exit(1);
}
