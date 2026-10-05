import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export function resolveRepo(input) {
  const repo = path.resolve(input || ".");
  return repo;
}

export async function assertRepo(repo) {
  const stat = await fs.stat(repo);
  if (!stat.isDirectory()) throw new Error("Repository path is not a directory.");
  const { stdout } = await exec("git", ["-C", repo, "rev-parse", "--show-toplevel"], {
    timeout: 10_000,
    maxBuffer: 1_000_000
  });
  const root = path.resolve(stdout.trim());
  if (root !== repo) throw new Error("Repository path must be the Git worktree root.");
  return root;
}

export async function git(repo, args, options = {}) {
  const { stdout, stderr } = await exec("git", ["-C", repo, ...args], {
    timeout: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? 4_000_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
  });
  return { stdout, stderr };
}

export async function discover(repo, maxDepth = 2) {
  const result = {};
  result.status = await git(repo, ["status", "--short"]);
  result.branch = await git(repo, ["branch", "--show-current"]);
  result.root = await git(repo, ["rev-parse", "--show-toplevel"]);
  const ignored = await git(repo, ["ls-files", "--others", "--exclude-standard"]);
  result.untracked = ignored.stdout.split("\n").filter(Boolean);
  result.files = await listFiles(repo, maxDepth);
  return result;
}

async function listFiles(root, maxDepth) {
  const output = [];
  async function walk(dir, depth) {
    if (depth > maxDepth) return;
    for (const name of await fs.readdir(dir, { withFileTypes: true })) {
      if (name.name === ".git" || name.name === "node_modules") continue;
      const full = path.join(dir, name.name);
      output.push(path.relative(root, full));
      if (name.isDirectory()) await walk(full, depth + 1);
    }
  }
  await walk(root, 0);
  return output.sort();
}

export async function makeWorktree(repo) {
  const base = await git(repo, ["rev-parse", "HEAD"]);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "apex-titan-"));
  const worktree = path.join(dir, "repo");
  await git(repo, ["worktree", "add", "--detach", worktree, base.stdout.trim()], { timeout: 60_000 });
  return { worktree, container: dir };
}

export async function removeWorktree(repo, worktree, container) {
  await git(repo, ["worktree", "remove", "--force", worktree], { timeout: 60_000 }).catch(() => {});
  await fs.rm(container, { recursive: true, force: true });
}

export async function runCheck(repo, command) {
  const started = Date.now();
  const result = { command, startedAt: new Date().toISOString() };
  try {
    const [program, ...args] = command;
    const out = await execFile(program, args, {
      cwd: repo,
      timeout: 120_000,
      maxBuffer: 8_000_000,
      env: { ...process.env, CI: "1" }
    });
    result.ok = true;
    result.stdout = out.stdout;
    result.stderr = out.stderr;
  } catch (error) {
    result.ok = false;
    result.stdout = error.stdout || "";
    result.stderr = error.stderr || error.message;
    result.code = error.code ?? null;
  }
  result.durationMs = Date.now() - started;
  return result;
}
