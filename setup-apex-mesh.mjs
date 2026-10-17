import fs from "node:fs";
import path from "node:path";

const required = [
  "src/core/mesh/claude-mesh-provider.mjs"
];
const securityImports = [
  'from "../../security/sovereign-outbound-gateway.mjs"'
];

for (const filePath of required) {
  if (!fs.existsSync(filePath)) {
    throw new Error("[SECURITY] Required provider file is missing; refusing to regenerate an unguarded provider: " + filePath);
  }
  const source = fs.readFileSync(filePath, "utf8");
  if (!securityImports.every(value => source.includes(value)) ||
      !source.includes("createGuardedFetch") ||
      !source.includes("sanitizeOutboundPayload")) {
    throw new Error("[SECURITY] Provider lacks outbound safeguards; refusing to overwrite it: " + filePath);
  }
  console.log("[VERIFIED]", path.normalize(filePath));
}
console.log("[SECURITY] Mesh providers verified; no files overwritten.");
