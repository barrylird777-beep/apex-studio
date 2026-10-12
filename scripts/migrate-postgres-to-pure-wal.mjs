#!/usr/bin/env node
import pg from "pg";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";

const { Pool, types } = pg;
types.setTypeParser(114, value => value); // Preserve JSON text instead of rounding large JSON numbers in JavaScript.
types.setTypeParser(3802, value => value); // Preserve JSONB text; source column type metadata records its SQL type.
const BATCH_SIZE = 250;
const cloneJson = value => JSON.parse(JSON.stringify(value));
const sha256 = value => createHash("sha256").update(String(value)).digest("hex");

export function quoteSqlIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function targetCollection(schema, table) {
  return "legacy-pg-" + sha256(schema).slice(0, 12) + "-" + sha256(table).slice(0, 12);
}

export function targetRecordId(schema, table, primaryKey, row, duplicateOrdinal = 0) {
  const identity = primaryKey?.length
    ? { primaryKey: primaryKey.map(key => [key, row[key]]) }
    : { row, duplicateOrdinal };
  return "pg-" + sha256(canonicalJson({ schema, table, identity }));
}

export function classifyTarget(existing, incoming) {
  if (!existing) return "new";
  return canonicalJson(existing.sourceRow) === canonicalJson(incoming.sourceRow) &&
    canonicalJson(existing.sourcePrimaryKey) === canonicalJson(incoming.sourcePrimaryKey) &&
    canonicalJson(existing.sourceForeignKeys) === canonicalJson(incoming.sourceForeignKeys)
    ? "identical" : "conflict";
}

export function parseMigrationArgs(args) {
  const options = { apply: false, schema: null, output: null, help: false };
  for (const arg of args) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--schema=") && arg.length > 9) options.schema = arg.slice(9);
    else if (arg.startsWith("--output=") && arg.length > 9) options.output = arg.slice(9);
    else throw new Error("Unknown or incomplete option: " + arg);
  }
  return options;
}

const HELP = `Dry-run-first PostgreSQL to Pure-WAL record migration.

Usage:
  DATABASE_URL=postgres://... node scripts/migrate-postgres-to-pure-wal.mjs [--schema=public] [--apply] [--output=FILE]

Default is dry-run: reads source rows in a read-only snapshot and reports planned inserts,
identical records, and conflicts. --apply is required before any Pure-WAL writes.
Every source row is stored with source schema/table, original column names and values,
primary-key metadata, and a stable source-row identity. Source SQL is never modified.
Existing target IDs are never overwritten; conflicts abort the preflight before writes.
`;

async function main() {
  const options = parseMigrationArgs(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw Object.assign(new Error("DATABASE_URL is required."), { exitCode: 2 });
  let url;
  try { url = new URL(connectionString); } catch {
    throw Object.assign(new Error("DATABASE_URL is not a valid connection URL."), { exitCode: 2 });
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw Object.assign(new Error("DATABASE_URL must use postgres:// or postgresql://."), { exitCode: 2 });
  }

  const root = process.env.APEX_SE_X_ROOT || "/srv/apex/se-x";
  const wal = new ApexRingWAL({ file: process.env.APEX_WAL_FILE || resolve(root, "wal/ring.wal.jsonl") });
  const store = new ApexPureStore({ root: process.env.APEX_PROJECTS_DIR || resolve(root, "projects"), wal });
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, max: 1 });
  const summary = { tables: 0, rowsRead: 0, planned: 0, identical: 0, conflicts: 0, written: 0, skipped: 0 };
  const tablePlans = [];
  let client;
  let migrationLockHandle;
  let migrationLockPath;
  try {
    await store.init();
    const fs = await import("node:fs/promises");
    migrationLockPath = resolve(root, ".legacy-pg-migration.lock");
    try {
      migrationLockHandle = await fs.open(migrationLockPath, "wx", 0o600);
      await migrationLockHandle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n", "utf8");
      await migrationLockHandle.sync();
    } catch (error) {
      if (error.code === "EEXIST") throw new Error("Another PostgreSQL-to-Pure-WAL migration holds the lock; refusing concurrent execution.");
      throw error;
    }
    client = await pool.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const tableResult = await client.query(`
      SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p')
        AND n.nspname <> 'information_schema'
        AND left(n.nspname,3) <> 'pg_'
        AND ($1::text IS NULL OR n.nspname=$1)
      ORDER BY n.nspname,c.relname
    `, [options.schema]);
    summary.tables = tableResult.rows.length;

    // Preflight every row and every target ID before allowing any write.
    for (const table of tableResult.rows) {
      const qualified = quoteSqlIdentifier(table.schema_name) + "." + quoteSqlIdentifier(table.table_name);
      const colsResult = await client.query(`
        SELECT column_name, ordinal_position, data_type, udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema=$1 AND table_name=$2
        ORDER BY ordinal_position
      `, [table.schema_name, table.table_name]);
      const columns = colsResult.rows.map(r => ({
        name: r.column_name,
        position: Number(r.ordinal_position),
        dataType: r.data_type,
        databaseType: r.udt_name,
        nullable: r.is_nullable === "YES"
      }));
      const pkResult = await client.query(`
        SELECT a.attname AS column_name, array_position(i.indkey, a.attnum) AS key_position
        FROM pg_index i
        JOIN pg_class t ON t.oid=i.indrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(i.indkey)
        WHERE i.indisprimary AND n.nspname=$1 AND t.relname=$2
        ORDER BY array_position(i.indkey, a.attnum)
      `, [table.schema_name, table.table_name]);
      const primaryKey = pkResult.rows.map(r => r.column_name);
      const foreignKeyResult = await client.query(`
        SELECT con.conname AS name,
               pg_get_constraintdef(con.oid, true) AS definition
        FROM pg_constraint con
        JOIN pg_class t ON t.oid=con.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE con.contype='f' AND n.nspname=$1 AND t.relname=$2
        ORDER BY con.conname
      `, [table.schema_name, table.table_name]);
      const sourceForeignKeys = foreignKeyResult.rows.map(r => ({ name: r.name, definition: r.definition }));
      const orderBy = primaryKey.length
        ? primaryKey.map(k => quoteSqlIdentifier(k)).join(",")
        : "row_to_json(src)::text";
      const collection = targetCollection(table.schema_name, table.table_name);
      const occurrences = new Map();
      const plannedRows = [];
      let offset = 0;
      while (true) {
        const result = await client.query(
          "SELECT * FROM " + qualified + " AS src" +
          " ORDER BY " + orderBy + " LIMIT $1 OFFSET $2",
          [BATCH_SIZE, offset]
        );
        if (!result.rows.length) break;
        offset += result.rows.length;
        for (const item of result.rows) {
          const sourceRow = cloneJson(item);
          const rowKey = canonicalJson(sourceRow);
          const duplicateOrdinal = occurrences.get(rowKey) || 0;
          occurrences.set(rowKey, duplicateOrdinal + 1);
          const id = targetRecordId(table.schema_name, table.table_name, primaryKey, sourceRow, duplicateOrdinal);
          const record = {
            migrationFormat: "apex-legacy-sql-row-v1",
            sourceSystem: "postgresql",
            sourceSchema: table.schema_name,
            sourceTable: table.table_name,
            sourcePrimaryKey: primaryKey.map(key => [key, sourceRow[key]]),
            sourceForeignKeys,
            sourceColumns: columns,
            sourceRow,
            sourceRowHash: sha256(canonicalJson(sourceRow))
          };
          const existing = await store.get(collection, id);
          const classification = classifyTarget(existing, record);
          summary.rowsRead++;
          if (classification === "new") summary.planned++;
          else if (classification === "identical") summary.identical++;
          else summary.conflicts++;
          plannedRows.push({ id, record, classification });
        }
      }
      tablePlans.push({ schema: table.schema_name, table: table.table_name, collection, rowCount: plannedRows.length, primaryKey, columns, sourceForeignKeys, rows: plannedRows });
    }

    if (summary.conflicts) {
      throw Object.assign(new Error("Preflight found " + summary.conflicts + " target conflicts; no writes were attempted."), { exitCode: 3, reportSummary: summary });
    }

    if (options.apply) {
      for (const table of tablePlans) {
        for (const row of table.rows) {
          if (row.classification === "identical") { summary.skipped++; continue; }
          const again = await store.get(table.collection, row.id);
          if (again) {
            if (classifyTarget(again, row.record) !== "identical") {
              throw new Error("Target changed after preflight; refusing to overwrite " + table.collection + "/" + row.id);
            }
            summary.skipped++;
            continue;
          }
          await store.put(table.collection, row.id, row.record);
          summary.written++;
        }
      }
    }

    await client.query("COMMIT");
    const report = {
      reportType: "apex-postgres-to-pure-wal-migration",
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: options.apply ? "apply" : "dry-run",
      safety: {
        sourceTransaction: "repeatable-read read-only",
        sourceModified: false,
        targetOverwriteAllowed: false,
        targetStorage: "Pure-WAL",
        rowValuesPreservedAsJson: true
      },
      summary,
      tables: tablePlans.map(({ schema, table, collection, rowCount, primaryKey, columns, sourceForeignKeys }) => ({ schema, table, collection, rowCount, primaryKey, columns, sourceForeignKeys }))
    };
    const output = JSON.stringify(report, null, 2) + "\n";
    if (options.output) {
      const { open, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(resolve(options.output)), { recursive: true, mode: 0o700 });
      const handle = await open(resolve(options.output), "wx", 0o600);
      try { await handle.writeFile(output, "utf8"); await handle.sync(); } finally { await handle.close(); }
      console.error("Migration report written to " + resolve(options.output));
    } else console.log(output);
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    if (error.reportSummary) console.error(JSON.stringify(error.reportSummary));
    throw error;
  } finally {
    client?.release();
    await pool.end();
    if (migrationLockHandle) await migrationLockHandle.close().catch(() => {});
    if (migrationLockHandle && migrationLockPath) {
      const fs = await import("node:fs/promises");
      await fs.unlink(migrationLockPath).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error("[postgres-to-pure-wal] " + String(error?.message || error));
    process.exitCode = Number(error?.exitCode) || 1;
  });
}
