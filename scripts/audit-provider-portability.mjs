#!/usr/bin/env node
/**
 * Read-only portability audit for the APEX Railway exit.
 * Does not print environment variable values, read secret files, or modify the repository.
 */
import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const ignored = new Set([".git", "node_modules", "dist", "coverage", ".next", ".wrangler"]);
const extensions = new Set([".mjs", ".cjs", ".js", ".ts", ".tsx", ".jsx", ".json", ".yml", ".yaml", ".toml", ".md", ".sh", ".dockerignore", ".env.example"]);
const patterns = [
  ["railway-specific", /railway(?:\.app|\.json|\.toml|\/|\b)/i],
  ["postgres-dependency", /postgres(?:ql)?:\/\/|\bpg(?:-pool)?\b|drizzle-orm\/pg|DATABASE_URL|PGHOST/i],
  ["local-file-persistence", /writeFile(?:Sync)?\s*\(|appendFile(?:Sync)?\s*\(|createWriteStream\s*\(|\.\/data\/|\bSTORAGE_DIR\b|\bDATA_DIR\b/i],
  ["json-file-store", /JSON\.stringify\s*\(|JSON\.parse\s*\(|\.json(?:['"`])|JsonStore/i],
  ["node-runtime-coupling", /from\s+['"]node:(?:fs|child_process|worker_threads|net|tls|http|https|path|os|stream)['"]|require\(['"](?:fs|child_process|worker_threads|net|tls)['"]\)/i],
  ["native-rendering", /ffmpeg|fluent-ffmpeg|spawn\s*\(|execFile\s*\(/i],
  ["custom-wal-terminology", /\bWAL\b|write-ahead log/i],
];
const findings = [];
let scanned = 0;
async function walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const ent of entries) {
    if (ent.name.startsWith(".env") && ent.name !== ".env.example") continue;
    if (ent.isDirectory() && ignored.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { await walk(full); continue; }
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name);
    if (!extensions.has(ext) && !["Dockerfile", "Procfile"].includes(ent.name)) continue;
    let content;
    try { content = await fs.readFile(full, "utf8"); } catch { continue; }
    scanned++;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      for (const [category, re] of patterns) {
        if (!re.test(lines[i])) continue;
        findings.push({ file: path.relative(root, full), line: i + 1, category });
        break;
      }
    }
  }
}
await walk(root);
const counts = Object.fromEntries([...new Set(patterns.map(([name]) => name))].map(name => [name, findings.filter(f => f.category === name).length]));
console.log(JSON.stringify({
  audit: "apex-provider-portability-static-scan",
  mode: "read-only",
  filesScanned: scanned,
  findingCount: findings.length,
  counts,
  findings: findings.sort((a,b) => a.file.localeCompare(b.file) || a.line-b.line).slice(0, 500),
  note: "Heuristic matches require review. A match is not proof of an active dependency; a clean scan is not proof of runtime independence."
}, null, 2));
