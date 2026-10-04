import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export function loadMigrations(dir) {
  const journalPath = join(dir, 'meta', '_journal.json');
  if (!existsSync(journalPath)) throw new Error(`missing ${journalPath} (are the migration files committed?)`);
  const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => {
    const file = join(dir, `${e.tag}.sql`);
    if (!existsSync(file)) throw new Error(`journal lists ${e.tag} but ${file} does not exist`);
    return {
      tag: e.tag,
      statements: readFileSync(file, 'utf8').split('--> statement-breakpoint').map((s) => s.trim()).filter(Boolean),
    };
  });
}

const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

function indexColumns(db, name) {
  return db.prepare(`PRAGMA index_info(${JSON.stringify(name)})`).all()
    .sort((a, b) => a.seqno - b.seqno).map((r) => r.name);
}

export function verifyMigrations({ dir, expectations = {} }) {
  let migrations;
  try { migrations = loadMigrations(dir); }
  catch (err) { return { ok: false, errors: [err.message] }; }
  if (!migrations.length) return { ok: false, errors: ['journal has no migrations'] };

  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const errors = [];

  for (const m of migrations) {
    for (const statement of m.statements) {
      try { db.exec(statement); }
      catch (err) { errors.push(`${m.tag}: ${err.message}`); }
    }
  }
  if (errors.length) return { ok: false, errors, migrationCount: migrations.length };

  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name));
  for (const table of expectations.tables ?? []) if (!tables.has(table)) errors.push(`missing table: ${table}`);
  const hasTable = (table) => tables.has(table) || (errors.push(`cannot check ${table}: table missing`), false);

  for (const { table, columns } of expectations.primaryKeys ?? []) {
    if (!hasTable(table)) continue;
    const pk = db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all()
      .filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    if (!same(pk, columns)) errors.push(`${table}: primary key is (${pk.join(', ')}), expected (${columns.join(', ')})`);
  }

  for (const kind of ['unique', 'indexes']) {
    for (const { table, columns } of expectations[kind] ?? []) {
      if (!hasTable(table)) continue;
      const found = db.prepare(`PRAGMA index_list(${JSON.stringify(table)})`).all()
        .some((ix) => (kind === 'indexes' || ix.unique === 1) && same(indexColumns(db, ix.name), columns));
      if (!found) errors.push(`${table}: no ${kind === 'unique' ? 'unique constraint' : 'index'} on (${columns.join(', ')})`);
    }
  }

  for (const { table, column, references, onDelete } of expectations.foreignKeys ?? []) {
    if (!hasTable(table)) continue;
    const fk = db.prepare(`PRAGMA foreign_key_list(${JSON.stringify(table)})`).all().find((r) => r.from === column);
    if (!fk) errors.push(`${table}.${column}: no foreign key`);
    else {
      if (fk.table !== references) errors.push(`${table}.${column}: references ${fk.table}, expected ${references}`);
      if (onDelete && fk.on_delete.toUpperCase() !== onDelete.toUpperCase()) errors.push(`${table}.${column}: ON DELETE ${fk.on_delete}, expected ${onDelete}`);
    }
  }

  return { ok: errors.length === 0, errors, migrationCount: migrations.length };
}
