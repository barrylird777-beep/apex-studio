import { execFileSync } from "node:child_process";

const AUTHORITATIVE_CHECKS = [
  { name: "certs", script: "security:certs" },
  { name: "storage", script: "security:storage" },
  { name: "tls", script: "security:tls" },
  { name: "crypto", script: "security:crypto" },
  { name: "network", script: "security:network" },
  { name: "negative-tls", script: "security:negative-tls" }
];

console.log("=== APEX SECURITY CHECK GATES ===");
let finalStatus = "PASS";

const checks = process.env.CI === 'true'
  ? AUTHORITATIVE_CHECKS.filter(check => check.name !== 'negative-tls')
  : AUTHORITATIVE_CHECKS;

for (const check of checks) {
  process.stdout.write(`Testing layer [${check.name}]... `);
  try {
    execFileSync("npm", ["run", check.script, "--", "--silent"], {
      stdio: "inherit",
      env: { ...process.env, APEX_RUN_DEPLOYED_TLS_TESTS: process.env.CI === "true" ? "false" : "true" }
    });
    console.log("PASS");
  } catch (error) {
    console.log("FAIL");
    finalStatus = "FAIL";
    break;
  }
}

console.log(`\nALL TESTS DONE: [${finalStatus}]`);
if (finalStatus !== "PASS") {
  process.exit(1);
}
