#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function verifyPostgresMigrations(dir = "drizzle-pg", expectPath = "scripts/spec005-expectations.json") {
  const journal = join(dir, "meta", "_journal.json");
  const errors = [];

  if (!existsSync(journal)) errors.push("missing " + journal);

  let entries = [];
  if (!errors.length) {
    const parsed = JSON.parse(readFileSync(journal, "utf8"));
    entries = Array.isArray(parsed.entries) ? parsed.entries : [];
    if (!entries.length) errors.push("migration journal has no entries");

    for (const e of entries) {
      const tag = String(e.tag || "");
      if (!tag) errors.push("migration entry is missing tag");
      else if (!existsSync(join(dir, tag + ".sql"))) errors.push("missing migration " + tag + ".sql");
    }
  }

  let sql = "";
  if (!errors.length) {
    sql = entries.map((e) => readFileSync(join(dir, e.tag + ".sql"), "utf8")).join("\n").toLowerCase();
  }

  if (/sqlite|better-sqlite|sqlite_master|pragma\s/.test(sql)) {
    errors.push("PostgreSQL migrations contain SQLite-specific SQL");
  }

  if (expectPath && existsSync(expectPath)) {
    const expected = JSON.parse(readFileSync(expectPath, "utf8"));
    for (const table of expected.tables || []) {
      if (!sql.includes('create table if not exists "' + String(table).toLowerCase() + '"')) {
        errors.push("missing table " + table);
      }
    }
    for (const index of expected.unique || []) {
      const cols = (index.columns || []).map((c) => '"' + String(c).toLowerCase() + '"').join(",");
      if (!sql.includes(cols)) {
        errors.push("missing unique/index columns " + index.table + "(" + index.columns.join(",") + ")");
      }
    }
  }

  if (errors.length) {
    console.error("FAILED:", ...errors.map((x) => "\n - " + x));
    process.exitCode = 1;
    return { ok: false, errors, migrationCount: entries.length };
  }

  console.log("OK: PostgreSQL migration journal and SQL checks passed:", entries.length, "migration(s)");
  return { ok: true, errors: [], migrationCount: entries.length };
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const args = process.argv.slice(2);
  const dir = args[args.indexOf("--dir") + 1] || "drizzle-pg";
  const expectPath = args[args.indexOf("--expect") + 1] || "scripts/spec005-expectations.json";
  verifyPostgresMigrations(dir, expectPath);
}
