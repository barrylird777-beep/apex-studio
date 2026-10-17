import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Apex Studio mounts an accessible voice/text assistant overlay', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/assistant-overlay.js', import.meta.url), 'utf8');
  assert.match(html, /\/assistant-overlay\.js/);
  assert.match(script, /role', 'dialog/);
  assert.match(script, /x-apex-shortcut-token/);
  assert.match(script, /SpeechRecognition/);
  assert.match(script, /SpeechSynthesisUtterance/);
  assert.match(script, /Stop audio/);
  assert.match(script, /Speech recognition is unavailable in this browser/);
});

test('assistant overlay does not write prompt history to browser persistence APIs', async () => {
  const script = await readFile(new URL('../public/assistant-overlay.js', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /localStorage\.setItem|indexedDB\.open|document\.cookie/);
  assert.match(script, /Conversation history is not saved by this overlay/);
});
