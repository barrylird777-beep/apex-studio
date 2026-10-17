import { spawn } from "node:child_process";

// Never install a predictable control-plane credential, even for local development.
// Set APEX_CONTROL_TOKEN or APEX_SHORTCUT_TOKEN explicitly when authenticated routes are needed.
const child = spawn(process.execPath, ["server.mjs", ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit"
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", error => {
  console.error("Failed to start sovereign API:", error);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
