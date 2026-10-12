#!/usr/bin/env node
import pg from "pg";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const HELP = `Read-only PostgreSQL inventory for a planned Pure-WAL migration.

Usage:
  DATABASE_URL=postgres://... node scripts/audit-postgres-for-pure-wal.mjs [--exact-counts] [--output=FILE]

Default mode uses PostgreSQL's row estimates to reduce production load.
--exact-counts runs COUNT(*) on each user table in one read-only snapshot.
--output writes the report with restrictive permissions; without it, JSON goes to stdout.
The report contains schema metadata and counts, not application row contents.
`;

export function quoteIdentifier(value) {
  return '"' + String(value).replaceAll('"', '""') + '"';
}

export function parseArgs(args) {
  const options = { exactCounts: false, output: null, help: false };
  for (const arg of args) {
    if (arg === "--exact-counts") options.exactCounts = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg.startsWith("--output=") && arg.length > 9) options.output = arg.slice(9);
    else throw new Error("Unknown or incomplete option: " + arg);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }

  const connectionString = String(process.env.DATABASE_URL || "").trim();
  if (!connectionString) throw Object.assign(new Error("DATABASE_URL is required."), { exitCode: 2 });
  let parsed;
  try { parsed = new URL(connectionString); }
  catch { throw Object.assign(new Error("DATABASE_URL is not a valid connection URL."), { exitCode: 2 }); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw Object.assign(new Error("DATABASE_URL must use postgres:// or postgresql://."), { exitCode: 2 });
  }

  const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  const ssl = process.env.APEX_PG_SSL === "false" || local ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString, ssl, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000, max: 1 });
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN READ ONLY");
    const db = await client.query(`
      SELECT current_database() AS database,
             current_user AS database_user,
             inet_server_addr()::text AS server_address,
             inet_server_port() AS server_port,
             current_setting('server_version') AS server_version,
             now() AS snapshot_started_at
    `);

    const tableResult = await client.query(`
      SELECT n.nspname AS schema_name,
             c.relname AS table_name,
             c.reltuples::bigint AS estimated_rows,
             c.relkind AS relation_kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p')
        AND n.nspname <> 'information_schema'
        AND left(n.nspname, 3) <> 'pg_'
      ORDER BY n.nspname, c.relname
    `);
    const tables = tableResult.rows.map(row => ({
      schema: row.schema_name,
      name: row.table_name,
      kind: row.relation_kind === "p" ? "partitioned-table" : "table",
      estimatedRows: Math.max(0, Number(row.estimated_rows) || 0),
      exactRows: null,
      columns: [],
      constraints: [],
      indexes: []
    }));

    const columns = await client.query(`
      SELECT table_schema, table_name, ordinal_position, column_name,
             data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema <> 'information_schema'
        AND table_schema NOT LIKE 'pg\\_%' ESCAPE '\\'
      ORDER BY table_schema, table_name, ordinal_position
    `);
    const byTable = new Map(tables.map(t => [t.schema + "." + t.name, t]));
    for (const column of columns.rows) {
      const table = byTable.get(column.table_schema + "." + column.table_name);
      if (table) table.columns.push({
        name: column.column_name,
        position: Number(column.ordinal_position),
        type: column.data_type,
        databaseType: column.udt_name,
        nullable: column.is_nullable === "YES",
        default: column.column_default
      });
    }

    const constraints = await client.query(`
      SELECT ns.nspname AS schema_name, tbl.relname AS table_name,
             con.conname AS name, con.contype AS type,
             pg_get_constraintdef(con.oid, true) AS definition
      FROM pg_constraint con
      JOIN pg_class tbl ON tbl.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
      WHERE ns.nspname <> 'information_schema'
        AND left(ns.nspname, 3) <> 'pg_'
      ORDER BY ns.nspname, tbl.relname, con.conname
    `);
    for (const constraint of constraints.rows) {
      const table = byTable.get(constraint.schema_name + "." + constraint.table_name);
      if (table) table.constraints.push({ name: constraint.name, type: constraint.type, definition: constraint.definition });
    }

    const indexes = await client.query(`
      SELECT schemaname AS schema_name, tablename AS table_name,
             indexname AS name, indexdef AS definition
      FROM pg_indexes
      WHERE schemaname <> 'information_schema'
        AND schemaname NOT LIKE 'pg\\_%' ESCAPE '\\'
      ORDER BY schemaname, tablename, indexname
    `);
    for (const index of indexes.rows) {
      const table = byTable.get(index.schema_name + "." + index.table_name);
      if (table) table.indexes.push({ name: index.name, definition: index.definition });
    }

    if (options.exactCounts) {
      for (const table of tables) {
        const sql = "SELECT count(*)::text AS count FROM " +
          quoteIdentifier(table.schema) + "." + quoteIdentifier(table.name);
        const result = await client.query(sql);
        table.exactRows = result.rows[0].count;
      }
    }

    let appliedMigrations = [];
    const ledger = await client.query("SELECT to_regclass('public.apex_schema_migrations') IS NOT NULL AS exists");
    if (ledger.rows[0].exists) {
      const migrationRows = await client.query("SELECT version, applied_at FROM public.apex_schema_migrations ORDER BY version");
      appliedMigrations = migrationRows.rows.map(row => ({ version: row.version, appliedAt: row.applied_at }));
    }

    const report = {
      reportType: "apex-postgres-pure-wal-migration-inventory",
      formatVersion: 1,
      generatedAt: new Date().toISOString(),
      safety: {
        databaseTransaction: "read-only",
        rowContentsExported: false,
        exactCountsRequested: options.exactCounts,
        exactCountsNote: options.exactCounts ? "COUNT(*) was run for each user table within the read-only transaction." : "Counts are planner estimates; run with --exact-counts when the database can tolerate the additional read load.",
        migrationExecuted: false,
        dataChanged: false
      },
      database: db.rows[0],
      summary: {
        tableCount: tables.length,
        columnCount: tables.reduce((sum, table) => sum + table.columns.length, 0),
        constraintCount: tables.reduce((sum, table) => sum + table.constraints.length, 0),
        indexCount: tables.reduce((sum, table) => sum + table.indexes.length, 0),
        appliedMigrationCount: appliedMigrations.length
      },
      appliedMigrations,
      tables
    };

    await client.query("COMMIT");
    const output = JSON.stringify(report, null, 2) + "\n";
    if (options.output) {
      const target = resolve(options.output);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await chmod(target, 0o600);
      console.error("Read-only inventory written to " + target);
    } else {
      console.log(output);
    }
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error("[pure-wal-inventory] " + String(error?.message || error));
    process.exitCode = Number(error?.exitCode) || 1;
  });
}
