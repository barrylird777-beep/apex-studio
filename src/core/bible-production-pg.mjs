import pg from "pg";

const { Pool } = pg;

export function toPostgresPlaceholders(sql) {
  const input = String(sql);
  let output = "";
  let index = 0;
  let state = "normal";
  let blockDepth = 0;
  let dollarDelimiter = "";

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (state === "single") {
      output += ch;
      if (ch === "\\" && i + 1 < input.length) {
        output += input[++i];
      } else if (ch === "'" && next === "'") {
        output += input[++i];
      } else if (ch === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double") {
      output += ch;
      if (ch === '"' && next === '"') {
        output += input[++i];
      } else if (ch === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "line-comment") {
      output += ch;
      if (ch === "\n") state = "normal";
      continue;
    }

    if (state === "block-comment") {
      if (ch === "/" && next === "*") {
        output += "/*";
        i += 1;
        blockDepth += 1;
      } else if (ch === "*" && next === "/") {
        output += "*/";
        i += 1;
        blockDepth -= 1;
        if (blockDepth === 0) state = "normal";
      } else {
        output += ch;
      }
      continue;
    }

    if (state === "dollar-quote") {
      if (input.startsWith(dollarDelimiter, i)) {
        output += dollarDelimiter;
        i += dollarDelimiter.length - 1;
        state = "normal";
      } else {
        output += ch;
      }
      continue;
    }

    if (ch === "'") {
      state = "single";
      output += ch;
    } else if (ch === '"') {
      state = "double";
      output += ch;
    } else if (ch === "-" && next === "-") {
      state = "line-comment";
      output += "--";
      i += 1;
    } else if (ch === "/" && next === "*") {
      state = "block-comment";
      blockDepth = 1;
      output += "/*";
      i += 1;
    } else if (ch === "$") {
      const match = input.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (match) {
        dollarDelimiter = match[0];
        state = "dollar-quote";
        output += dollarDelimiter;
        i += dollarDelimiter.length - 1;
      } else {
        output += ch;
      }
    } else if (ch === "?") {
      output += "$" + (++index);
    } else {
      output += ch;
    }
  }

  return output;
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
