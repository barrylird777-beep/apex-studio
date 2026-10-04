import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ORDER = [
  'identity', 'hook', 'assemble', 'cache', 'wav', 'gemini', 'script', 'produce', 'events',
  'books', 'ledger', 'pipeline', 'popcorn', 'cornnuts', 'protocob', 'publish', 'scout', 'pg-ledger',
];
const DIRS = ['src/video', 'src/jobs', 'scripts', 'test'];
const LOAD_DIRS = ['src/video', 'src/jobs'];

const problems = [];
const bad = (m) => problems.push(m);

const missing = ORDER.filter((n) => !existsSync(`src/video/${n}.mjs`));
if (missing.length) bad(`missing src/video files (${missing.length}/${ORDER.length}): ${missing.join(', ')}`);

const files = DIRS.flatMap((d) =>
  existsSync(d) ? readdirSync(d).filter((f) => f.endsWith('.mjs')).map((f) => path.join(d, f)) : [],
);

const exportsOf = (src) => {
  const s = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) s.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const n of m[1].split(',')) {
      const t = n.trim().split(/\s+as\s+/).pop();
      if (t) s.add(t);
    }
  }
  return s;
};

const cache = new Map();
const exportsFor = (file) => {
  if (!cache.has(file)) cache.set(file, exportsOf(readFileSync(file, 'utf8')));
  return cache.get(file);
};

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const here = path.dirname(file);

  for (const m of src.matchAll(/import\s+([^'";]*?)\s+from\s+['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(here, m[2]);
    if (!existsSync(target)) { bad(`${file}: imports ${m[2]} which does not exist`); continue; }
    const named = /\{([^}]*)\}/.exec(m[1]);
    if (!named) continue;
    const have = exportsFor(target);
    for (const n of named[1].split(',')) {
      const name = n.trim().split(/\s+as\s+/)[0];
      if (name && !have.has(name)) bad(`${file}: imports { ${name} } from ${m[2]} but it is not exported`);
    }
  }

  for (const m of src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    if (!existsSync(path.resolve(here, m[1]))) bad(`${file}: dynamic import ${m[1]} does not exist`);
  }
}

for (const d of LOAD_DIRS) {
  if (!existsSync(d)) continue;
  for (const f of readdirSync(d).filter((x) => x.endsWith('.mjs'))) {
    const p = path.resolve(d, f);
    try { await import(pathToFileURL(p).href); }
    catch (e) { bad(`${path.join(d, f)}: failed to load: ${String(e.message).split('\\n')[0]}`); }
  }
}

const read = (f) => (existsSync(`src/video/${f}`) ? readFileSync(`src/video/${f}`, 'utf8') : null);
const must = (f, re, why) => { const s = read(f); if (s !== null && !re.test(s)) bad(`${f}: ${why}`); };
const mustNot = (f, re, why) => { const s = read(f); if (s !== null && re.test(s)) bad(`${f}: ${why}`); };

must('produce.mjs', /tts-v2/, 'tts-v2 WAV patch not applied (sample rate is lost on cached runs)');
must('produce.mjs', /^import\s*\{[^}]*readFile[^}]*\}\s*from\s*'node:fs\/promises'/m, 'readFile must be a static import');
must('pipeline.mjs', /export\s+async\s+function\s+acquireLock/, 'acquireLock is not exported');
must('events.mjs', /canonicalBook/, 'books.mjs patch not applied (Jude/Judges collision remains)');
must('protocob.mjs', /scoutPassageUnlocked/, 'scoutPassage was not renamed to scoutPassageUnlocked');
mustNot('protocob.mjs', /createFileLedger/, 'file-ledger default still present');
must('publish.mjs', /never finished/, 'old publish.mjs: replace with the hardened version');

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`OK: ${files.length} files checked, all ${ORDER.length} video modules present, imports and patches verified.`);
