import pg from "pg";

const { Pool } = pg;

function toPostgresPlaceholders(sql) {
  let index = 0;
  return String(sql).replace(/\?/g, () => "$" + (++index));
}

function normalizeSql(sql) {
  return String(sql)
    .replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+/i, "INSERT INTO ")
    .replace(/\s+OR\s+IGNORE\s+/gi, " ");
}

function hasIgnore(sql) {
  return /^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+/i.test(String(sql));
}

export function createBibleProductionStore(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for Bible production persistence");

  const pool = options.pool || new Pool({
    connectionString,
    max: Number(options.max ?? process.env.APEX_BIBLE_DB_POOL_MAX ?? 8),
    idleTimeoutMillis: Number(options.idleTimeoutMillis ?? 30000),
    connectionTimeoutMillis: Number(options.connectionTimeoutMillis ?? 10000),
    // Verify PostgreSQL server certificates by default. Set APEX_PG_SSL=false
    // only for explicitly trusted local/test environments.
    ssl: options.ssl ?? (process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: true })
  });

  const ownsPool = !options.pool;

  async function ready() {
    await pool.query("SELECT 1");
  }

  async function run(sql, params = []) {
    const original = String(sql);
    let normalized = normalizeSql(original);
    const ignored = hasIgnore(original);
    const isInsert = /^\s*INSERT\s+/i.test(normalized);
    const returnsId = isInsert && !ignored && !/\bRETURNING\b/i.test(normalized) && !/scene_shoot_days/i.test(normalized);

    if (returnsId) normalized += " RETURNING id";
    if (ignored && !/\bON\s+CONFLICT\b/i.test(normalized)) normalized += " ON CONFLICT DO NOTHING";

    const result = await pool.query(toPostgresPlaceholders(normalized), params);
    return {
      id: result.rows[0]?.id ?? null,
      lastID: result.rows[0]?.id ?? null,
      changes: result.rowCount,
      rows: result.rows
    };
  }

  async function all(sql, params = []) {
    const result = await pool.query(toPostgresPlaceholders(normalizeSql(sql)), params);
    return result.rows;
  }

  async function get(sql, params = []) {
    const result = await pool.query(toPostgresPlaceholders(normalizeSql(sql)), params);
    return result.rows[0] ?? null;
  }

  async function close() {
    if (ownsPool) await pool.end();
  }

  return Object.freeze({ pool, ready, run, all, get, close });
}
