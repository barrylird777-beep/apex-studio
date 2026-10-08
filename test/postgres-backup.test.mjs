import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const script = join(process.cwd(), "scripts", "backup-postgres.mjs");

function run(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test("postgres backup requires DATABASE_URL", async () => {
  const result = await run({ DATABASE_URL: "" });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /DATABASE_URL is required/);
});

test("postgres backup rejects non-PostgreSQL URLs", async () => {
  const result = await run({ DATABASE_URL: "https://example.invalid/db" });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /valid PostgreSQL connection URL/);
});

test("postgres backup passes credentials through the environment, not pg_dump argv", async () => {
  const root = await mkdtemp(join(tmpdir(), "apex-backup-test-"));
  const fakeDump = join(root, "fake-pg-dump.sh");
  const outputDir = join(root, "backups");

  await writeFile(fakeDump, `#!/bin/sh
output=""
for arg in "$@"; do
  case "$arg" in
    --file) next_is_file=1 ;;
    *)
      if [ "\${next_is_file:-0}" = "1" ]; then
        output="$arg"
        next_is_file=0
      fi
      case "$arg" in
        *secret-password*) exit 9 ;;
      esac
      ;;
  esac
done
[ -n "$output" ] || exit 8
[ "$PGPASSWORD" = "secret-password" ] || exit 7
[ "$PGUSER" = "backup-user" ] || exit 6
[ "$PGHOST" = "db.example" ] || exit 5
[ "$PGPORT" = "5432" ] || exit 4
[ "$PGDATABASE" = "apex" ] || exit 3
[ "$PGSSLMODE" = "require" ] || exit 2
printf 'APEX-POSTGRES-BACKUP' > "$output"
`, "utf8");
  await chmod(fakeDump, 0o700);

  const result = await run({
    DATABASE_URL: "postgresql://backup-user:secret-password@db.example:5432/apex?sslmode=require",
    PG_DUMP_BIN: fakeDump,
    APEX_BACKUP_DIR: outputDir
  });

  assert.equal(result.code, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  const dump = await readFile(summary.backup);
  const manifest = await readFile(summary.manifest, "utf8");

  assert.equal(dump.toString(), "APEX-POSTGRES-BACKUP");
  assert.match(manifest, new RegExp(`^${summary.sha256}\\s+`));
  assert.doesNotMatch(result.stdout, /secret-password/);
  assert.doesNotMatch(result.stderr, /secret-password/);

  await rm(root, { recursive: true, force: true });
});
