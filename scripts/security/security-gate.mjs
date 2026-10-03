import { execFileSync } from "node:child_process";

const AUTHORITATIVE_CHECKS = [
  { name: "certs", script: "security:certs" },
  { name: "storage", script: "security:storage" },
  { name: "tls", script: "security:tls" },
  { name: "crypto", script: "security:crypto" },
  { name: "network", script: "security:network" }
];

console.log("=== APEX SECURITY CHECK GATES ===");
let finalStatus = "PASS";

for (const check of AUTHORITATIVE_CHECKS) {
  process.stdout.write(`Testing layer [${check.name}]... `);
  try {
    execFileSync("npm", ["run", check.script, "--", "--silent"], {
      stdio: "inherit"
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
