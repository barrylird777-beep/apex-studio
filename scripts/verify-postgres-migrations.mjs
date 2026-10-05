#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const root = fileURLToPath(new URL("../", import.meta.url));
const migrationsDir = path.join(root, "postgres", "migrations");

function quoteIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

function migrationFiles() {
  return fs.readdir(migrationsDir).then(files =>
    files.filter(name => /^\d+_.+\.sql$/.test(name)).sort()
  );
}

async function runMigrations(client, files) {
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function relationExists(client, table) {
  const { rows } = await client.query(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${table}`],
  );
  return rows[0]?.exists === true;
}

async function indexColumns(client, indexName) {
  const { rows } = await client.query(
    `SELECT a.attname
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
      WHERE c.relname = $1
      ORDER BY k.ord`,
    [indexName],
  );
  return rows.map(row => row.attname);
}

async function verify({ client, expectations }) {
  const errors = [];
  const tables = new Set(
    (await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    )).rows.map(row => row.tablename),
  );

  for (const table of expectations.tables ?? []) {
    if (!tables.has(table)) errors.push(`missing table: ${table}`);
  }

  for (const { table, columns } of expectations.primaryKeys ?? []) {
    if (!tables.has(table)) continue;
    const { rows } = await client.query(
      `SELECT a.attname
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conrelid = $1::regclass AND c.contype = 'p'
        ORDER BY k.ord`,
      [`public.${table}`],
    );
    const actual = rows.map(row => row.attname);
    if (JSON.stringify(actual) !== JSON.stringify(columns)) {
      errors.push(`${table}: primary key is (${actual.join(", ")}), expected (${columns.join(", ")})`);
    }
  }

  for (const kind of ["unique", "indexes"]) {
    for (const { table, columns } of expectations[kind] ?? []) {
      if (!tables.has(table)) continue;
      const { rows } = await client.query(
        `SELECT c.relname AS index_name, i.indisunique
           FROM pg_index i
           JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = $1::regclass
            AND NOT i.indisprimary`,
        [`public.${table}`],
      );
      let found = false;
      for (const row of rows) {
        if (kind === "unique" && !row.indisunique) continue;
        const actual = await indexColumns(client, row.index_name);
        if (JSON.stringify(actual) === JSON.stringify(columns)) {
          found = true;
          break;
        }
      }
      if (!found) {
        errors.push(`${table}: no ${kind === "unique" ? "unique constraint" : "index"} on (${columns.join(", ")})`);
      }
    }
  }

  const deleteActions = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
  for (const { table, column, references, onDelete } of expectations.foreignKeys ?? []) {
    if (!tables.has(table)) continue;
    const { rows } = await client.query(
      `SELECT a.attname AS column_name, target.relname AS referenced_table, c.confdeltype
         FROM pg_constraint c
         JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
         JOIN pg_class target ON target.oid = c.confrelid
        WHERE c.conrelid = $1::regclass AND c.contype = 'f' AND k.ord = 1`,
      [`public.${table}`],
    );
    const fk = rows.find(row => row.column_name === column);
    if (!fk) errors.push(`${table}.${column}: no foreign key`);
    else {
      if (fk.referenced_table !== references) {
        errors.push(`${table}.${column}: references ${fk.referenced_table}, expected ${references}`);
      }
      const actualDelete = deleteActions[fk.confdeltype] ?? fk.confdeltype;
      if (onDelete && actualDelete.toUpperCase() !== onDelete.toUpperCase()) {
        errors.push(`${table}.${column}: ON DELETE ${actualDelete}, expected ${onDelete}`);
      }
    }
  }

  return errors;
}

export async function verifyPostgresMigrations({ databaseUrl = process.env.DATABASE_URL, expectations = {} } = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL migration verification.");

  const admin = new Client({ connectionString: databaseUrl });
  const dbName = `apex_verify_${process.pid}_${Date.now()}`;
  let target;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quoteIdentifier(dbName)}`);
    const targetUrl = new URL(databaseUrl);
    targetUrl.pathname = `/${dbName}`;
    target = new Client({ connectionString: targetUrl.toString() });
    await target.connect();

    const files = await migrationFiles();
    if (!files.length) throw new Error("postgres/migrations contains no migrations");
    await runMigrations(target, files);
    const errors = await verify({ client: target, expectations });
    return { ok: errors.length === 0, errors, migrationCount: files.length };
  } finally {
    await target?.end().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(dbName)} WITH (FORCE)`).catch(() => {});
    await admin.end().catch(() => {});
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const expectationsPath = process.argv[2] || path.join(root, "scripts", "spec005-expectations.json");
  const expectations = JSON.parse(await fs.readFile(expectationsPath, "utf8"));
  try {
    const result = await verifyPostgresMigrations({ expectations });
    if (!result.ok) {
      console.error("FAILED: committed PostgreSQL migrations do not reproduce the expected schema:");
      for (const error of result.errors) console.error(`  - ${error}`);
      process.exit(1);
    }
    console.log(`OK: ${result.migrationCount} PostgreSQL migration(s) rebuild the expected schema from an empty database.`);
  } catch (error) {
    console.error(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
