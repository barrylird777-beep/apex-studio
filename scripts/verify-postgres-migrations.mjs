#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function verifyPostgresMigrations(dir = "drizzle-pg", expectPath = "scripts/spec005-expectations.json") {
  const journal = join(dir, "meta", "_journal.json");
  const errors = [];
  if (!existsSync(journal)) errors.push("missing " + journal);
  let entries = [];
  if (!errors.length) {
    entries = JSON.parse(readFileSync(journal, "utf8")).entries || [];
    for (const entry of entries) {
      if (!existsSync(join(dir, entry.tag + ".sql"))) errors.push("missing migration " + entry.tag + ".sql");
    }
  }
  const sql = entries.map(entry => readFileSync(join(dir, entry.tag + ".sql"), "utf8")).join("\n").toLowerCase();
  if (/sqlite|better-sqlite|sqlite_master|pragma\s/.test(sql)) errors.push("PostgreSQL migrations contain SQLite-specific SQL");
  if (expectPath && existsSync(expectPath)) {
    const expected = JSON.parse(readFileSync(expectPath, "utf8"));
    for (const table of expected.tables || []) {
      if (!sql.includes('create table if not exists "' + table.toLowerCase() + '"')) errors.push("missing table " + table);
    }
    for (const unique of expected.unique || []) {
      if (!sql.includes(unique.columns.map(column => '"' + column.toLowerCase() + '"').join(","))) {
        errors.push("missing unique/index columns " + unique.table + "(" + unique.columns.join(",") + ")");
      }
    }
  }
  return { ok: errors.length === 0, errors, migrationCount: entries.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = verifyPostgresMigrations();
  if (!result.ok) {
    console.error("FAILED:", ...result.errors.map(error => "\n - " + error));
    process.exitCode = 1;
  } else {
    console.log("OK: PostgreSQL migration journal and SQL checks passed:", result.migrationCount, "migration(s)");
  }
}
