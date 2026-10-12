import { spawn } from "node:child_process";

process.env.APEX_CONTROL_TOKEN ||= process.env.APEX_SHORTCUT_TOKEN || "local-dev-control-token";
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
