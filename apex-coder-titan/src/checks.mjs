import { promises as fs } from "node:fs";
import path from "node:path";
import { runCheck } from "./repo.mjs";

const packageScripts = {
  "test": [["npm", "test"]],
  "build": [["npm", "run", "build"]],
  "typecheck": [["npm", "run", "typecheck"]],
  "lint": [["npm", "run", "lint"]]
};

export async function discoverChecks(repo) {
  let pkg = {};
  try {
    pkg = JSON.parse(await fs.readFile(path.join(repo, "package.json"), "utf8"));
  } catch {}
  const scripts = pkg.scripts || {};
  const checks = [];
  for (const [name, commands] of Object.entries(packageScripts)) {
    if (scripts[name]) checks.push({ name, command: commands[0] });
  }
  if (scripts["verify:migrations"]) checks.push({ name: "verify:migrations", command: ["npm", "run", "verify:migrations"] });
  if (scripts["smoke:005"]) checks.push({ name: "smoke:005", command: ["npm", "run", "smoke:005"] });
  if (scripts["smoke:production"]) checks.push({ name: "smoke:production", command: ["npm", "run", "smoke:production"] });
  return checks;
}

export async function runChecks(repo, checks) {
  const evidence = [];
  for (const check of checks) {
    evidence.push({ name: check.name, ...(await runCheck(repo, check.command)) });
  }
  return evidence;
}
