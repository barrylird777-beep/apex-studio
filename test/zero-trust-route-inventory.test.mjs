import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Direct Express route scan only. Mounted routers need a separate audit.
const PUBLIC_BY_DESIGN = new Map([
  ["/health", "Platform liveness probe; no private state."],
  ["/ready", "Platform readiness probe; no secrets or user data."],
  ["/api/health", "Public basic health signal only."],
  ["/api/apex/readiness", "Public readiness signal only; must not expose secrets."],
  ["/api/search", "Public search entry point; rate-limited in its handler."],
  ["/api/rapid/stripe/webhook", "Public payment-provider callback; signature verification required before processing."]
]);

const AUTH_MARKERS = [
  "requireControlPlaneAuth",
  "requireWorkerAuth",
  "requireOpportunityEngineAuth",
  "requirePublicRequestSlot",
  "requireAuth"
];

function routeDeclarations(source) {
  const lines = source.split("\n");
  const routes = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*app\.(get|post|put|patch|delete|all)\(\s*(['"])(\/[^'"]+)\2\s*,/);
    if (!match) continue;
    const block = lines.slice(index, Math.min(index + 10, lines.length)).join("\n").split("=>", 1)[0];
    const routePath = match[3];
    if (!routePath.startsWith("/api/") && routePath !== "/health" && routePath !== "/ready") continue;
    const guarded = AUTH_MARKERS.some(marker => block.includes(marker));
    routes.push({ line: index + 1, method: match[1].toUpperCase(), path: routePath, guarded });
  }
  return routes;
}


test("mounted API routers enforce receiver-side authorization", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const teevee = await readFile(new URL("../src/api/teevee-production-api.mjs", import.meta.url), "utf8");
  const research = await readFile(new URL("../src/api/research-routes.mjs", import.meta.url), "utf8");
  const library = await readFile(new URL("../src/api/kernelodies-library.mjs", import.meta.url), "utf8");
  const discovery = await readFile(new URL("../src/api/kernelodies-discovery.mjs", import.meta.url), "utf8");
  const phone = await readFile(new URL("../src/api/phone-control-plane.mjs", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../src/api/mobile-control-plane.mjs", import.meta.url), "utf8");

  assert.match(server, /app\\.use\\(['"]\\/api\\/relay['"],\\s*requireControlPlaneAuth,/);
  assert.match(server, /app\\.use\\(['"]\\/api\\/studio\\/audio['"],\\s*requireControlPlaneAuth,/);
  assert.match(server, /createTeeVeeProductionRouter\\(\\{[^}]*requireAuth:\\s*requireControlPlaneAuth/s);
  assert.match(teevee, /router\\.use\\(requireAuth\\s*\\|\\|/);
  assert.match(research, /router\\.(get|post)\\([^\\n]*requireResearchAuth/);
  assert.match(library, /router\\.use\\(authorize\\)/);
  assert.match(discovery, /router\\.use\\(authorize\\)/);
  assert.match(phone, /router\\.use\\(requirePhoneAuth\\)/);
  assert.match(mobile, /router\\.use\\(requireShortcutAuth\\)/);
});
\ntest("every direct API route is guarded or explicitly approved as public", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const routes = routeDeclarations(server);
  assert.ok(routes.length > 0, "route inventory must not be empty");

  const unclassified = routes.filter(route => !route.guarded && !PUBLIC_BY_DESIGN.has(route.path));
  assert.deepEqual(
    unclassified.map(route => `${route.method} ${route.path} (server.mjs:${route.line})`),
    [],
    "ZERO-TRUST RELEASE BLOCKER: every route must have a receiver-side auth guard or a reviewed public exception."
  );

  const stripeStart = server.indexOf("app.post('/api/rapid/stripe/webhook'");
  assert.notEqual(stripeStart, -1, "Stripe webhook route must exist");
  const stripeHandler = server.slice(stripeStart, server.indexOf("\napp.", stripeStart + 1));
  assert.match(stripeHandler, /verifyRapidStripeSignature\(req\.body, req\.headers\['stripe-signature'\], process\.env\.STRIPE_WEBHOOK_SECRET\)/, "public Stripe webhook must verify the provider signature before processing");

  for (const route of routes.filter(route => PUBLIC_BY_DESIGN.has(route.path))) {
    assert.ok(PUBLIC_BY_DESIGN.get(route.path).length > 12, `public exception requires a reason: ${route.method} ${route.path}`);
  }
});
