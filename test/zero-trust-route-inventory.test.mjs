import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// This intentionally scans direct Express route declarations. Mounted routers
// require a separate router-level audit; passing this test alone is not a full
// zero-trust certification.
const PUBLIC_BY_DESIGN = new Map([
  ["/health", "Platform liveness probe; no private state."],
  ["/ready", "Platform readiness probe; no secrets or user data."],
  ["/api/health", "Public basic health signal only."],
  ["/api/apex/readiness", "Public readiness signal only; must not expose secrets."],
  ["/api/search", "Public search entry point; rate-limited in its handler."]
]);

const AUTH_MARKERS = [
  "requireControlPlaneAuth",
  "requireWorkerAuth",
  "requireOpportunityEngineAuth",
  "requirePublicRequestSlot",
  "verifyRapidStripeSignature",
  "opportunityEngineTokenMatches",
  "requireAuth"
];

function routeDeclarations(source) {
  const lines = source.split("\n");
  const routes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*app\.(get|post|put|patch|delete|all)\((.*)$/);
    if (!match) continue;
    const block = lines.slice(index, Math.min(index + 8, lines.length)).join("\n").split("=>", 1)[0];
    const pathMatch = match[2].match(/^\s*(?:\[\s*)?['"]([^'"]+)['"]/);
    if (!pathMatch) continue; // Dynamic/nonliteral paths need a separate manual review.
    const routePath = pathMatch[1];
    if (!routePath.startsWith("/api/") && routePath !== "/health" && routePath !== "/ready") continue;
    const guarded = AUTH_MARKERS.some(marker => block.includes(marker));
    routes.push({ line: index + 1, method: match[1].toUpperCase(), path: routePath, guarded });
  }
  return routes;
}

test("every direct API route is guarded or explicitly approved as public", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const routes = routeDeclarations(server);
  assert.ok(routes.length > 0, "route inventory must not be empty");

  const unclassified = routes.filter(route =>
    !route.guarded && !PUBLIC_BY_DESIGN.has(route.path)
  );

  assert.deepEqual(
    unclassified.map(route => `${route.method} ${route.path} (server.mjs:${route.line})`),
    [],
    "ZERO-TRUST RELEASE BLOCKER: every route must have an auth guard or a reviewed public-by-design exception. Review these routes, add receiver-side authorization or document a narrowly scoped public exception, then rerun."
  );

  for (const route of routes.filter(route => PUBLIC_BY_DESIGN.has(route.path))) {
    assert.ok(PUBLIC_BY_DESIGN.get(route.path).length > 12, `public exception requires a reason: ${route.method} ${route.path}`);
  }
});
