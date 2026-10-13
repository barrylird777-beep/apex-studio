import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PUBLIC_BY_DESIGN = new Map([
  ["/health", "Platform liveness only."],
  ["/ready", "Platform readiness only."],
  ["/api/apex/readiness", "Canonical app readiness only."],
  ["/api/search", "Public search; rate-limited and query-bounded."],
  ["/api/teevee/buyer", "Public buyer catalog metadata only."],
  ["/api/rapid/stripe/webhook", "Public provider callback; signature verification is mandatory."]
]);
const AUTH_MARKERS = ["requireControlPlaneAuth", "requireWorkerAuth", "requireOpportunityEngineAuth", "requirePublicRequestSlot", "requireAuth", "requireAiInferenceAuth", "requireOverseerMetricsAuth"];
function routeDeclarations(source) {
  const lines = source.split("\n"), routes = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*app\.(get|post|put|patch|delete|all)\(\s*(['"])(\/[^'"]+)\2\s*,/);
    if (!m) continue;
    const block = lines.slice(i, Math.min(i + 12, lines.length)).join("\n");
    const routePath = m[3];
    if (!routePath.startsWith("/api/") && routePath !== "/health" && routePath !== "/ready") continue;
    routes.push({ line: i + 1, method: m[1].toUpperCase(), path: routePath, guarded: AUTH_MARKERS.some(marker => block.includes(marker)) });
  }
  return routes;
}
test("mounted routers enforce receiver-side authorization", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const teevee = await readFile(new URL("../src/api/teevee-production-api.mjs", import.meta.url), "utf8");
  const research = await readFile(new URL("../src/api/research-routes.mjs", import.meta.url), "utf8");
  const library = await readFile(new URL("../src/api/kernelodies-library.mjs", import.meta.url), "utf8");
  const discovery = await readFile(new URL("../src/api/kernelodies-discovery.mjs", import.meta.url), "utf8");
  const phone = await readFile(new URL("../src/api/phone-control-plane.mjs", import.meta.url), "utf8");
  const mobile = await readFile(new URL("../src/api/mobile-control-plane.mjs", import.meta.url), "utf8");
  assert.ok(server.includes("app.use('/api/relay', requireControlPlaneAuth,"));
  assert.ok(server.includes("app.use('/api/studio/audio', requireControlPlaneAuth,"));
  assert.ok(server.includes("createTeeVeeProductionRouter({ enqueue: enqueueWorkerTask, requireAuth: requireControlPlaneAuth })"));
  assert.ok(teevee.includes("router.use(requireAuth ||"));
  assert.match(research, /requireResearchAuth/);
  assert.ok(library.includes("router.use(authorize)"));
  assert.ok(discovery.includes("router.use(authorize)"));
  assert.ok(phone.includes("router.use(requirePhoneAuth)"));
  assert.ok(mobile.includes("router.use(requireShortcutAuth)"));
});
test("every direct API route is guarded or has an explicit public exception", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const routes = routeDeclarations(server);
  assert.ok(routes.length > 0);
  const unclassified = routes.filter(route => !route.guarded && !PUBLIC_BY_DESIGN.has(route.path));
  assert.deepEqual(unclassified.map(r => `${r.method} ${r.path} (server.mjs:${r.line})`), [], "Every API route must be guarded or deliberately public with a documented reason.");
  const stripeStart = server.indexOf("app.post('/api/rapid/stripe/webhook'");
  assert.notEqual(stripeStart, -1);
  const stripeEnd = server.indexOf("\napp.", stripeStart + 1);
  const stripeHandler = server.slice(stripeStart, stripeEnd < 0 ? undefined : stripeEnd);
  assert.match(stripeHandler, /verifyRapidStripeSignature/);
});
