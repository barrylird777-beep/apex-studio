import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { APEX_APPS } from "../src/apps/apex-six-apps.mjs";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");
const normalize = value => value.split("?")[0].replace(/\/+$/, "") || "/";
const routeMatches = (route, path) => {
  const a = normalize(route).split("/").filter(Boolean);
  const b = normalize(path).split("/").filter(Boolean);
  return a.length === b.length && a.every((part, index) => part.startsWith(":") || part === b[index]);
};
const extractRoutes = source => [...source.matchAll(/(?:app|router)\.(?:get|post|put|patch|delete|all)\(\s*['"`]([^'"`]+)['"`]/g)].map(match => match[1]);
const extractApiPaths = source => [...new Set([...source.matchAll(/['"`](\/api\/[A-Za-z0-9_./?=&:-]+)['"`]/g)].map(match => normalize(match[1])))];

test("every canonical app page references only implemented API routes", async () => {
  const [server, mobile] = await Promise.all([read("../server.mjs"), read("../src/api/mobile-control-plane.mjs")]);
  const serverRoutes = extractRoutes(server);
  const mobileRoutes = extractRoutes(mobile);
  const failures = [];
  for (const app of Object.values(APEX_APPS)) {
    const surface = app.id === "planet-apex" ? "planet-apex.html" : app.entry.slice(1);
    const page = await read("../public/" + surface);
    for (const path of extractApiPaths(page)) {
      const found = path.startsWith("/api/mobile/")
        ? mobileRoutes.some(route => routeMatches(route, path.slice("/api/mobile".length)))
        : serverRoutes.some(route => routeMatches(route, path));
      if (!found) failures.push(app.name + ": " + path);
    }
  }
  assert.deepEqual(failures, []);
});


test("canonical handoff uses the durable fabric dispatch payload contract", async () => {
  const server = await read("../server.mjs");
  const start = server.indexOf("app.post('/api/canon/handoff'");
  const end = server.indexOf("app.get('/api/canon/handoff'", start);
  assert.ok(start >= 0 && end > start);
  const route = server.slice(start, end);
  assert.match(route, /sovereignAppFabric\.dispatch\(\{\s*appId:\s*target/);
  assert.match(route, /data:\s*\{\s*from:\s*source,\s*to:\s*target/);
  assert.match(route, /sovereignAppFabric\.put\(target,\s*waveId/);
  assert.doesNotMatch(route, /sovereignAppFabric\.dispatch\(source,/);
});

test("KoinKob simulation runs are durably stored and surfaced in history", async () => {
  const [server, page] = await Promise.all([read("../server.mjs"), read("../public/koin-kob.html")]);
  const listStart = server.indexOf("app.get('/api/koin-kob/simulations'");
  const simulationStart = server.indexOf("app.post('/api/koin-kob/simulation'");
  const nextRoute = server.indexOf("app.get('/api/canon/trajectory'");
  assert.ok(listStart >= 0 && simulationStart > listStart && nextRoute > simulationStart);
  const listRoute = server.slice(listStart, simulationStart);
  const simulationRoute = server.slice(simulationStart, nextRoute);
  assert.match(listRoute, /requireControlPlaneAuth/);
  assert.match(listRoute, /listKoinKobRecords/);
  assert.match(simulationRoute, /saveKoinKobRecord\(simulationId, record\)/);
  assert.match(simulationRoute, /recordType:\s*['"]simulation['"]/);
  assert.match(page, /\/api\/koin-kob\/simulations/);
  assert.match(page, /savedRuns/);
});

test("all six canonical phone surfaces avoid browser-local data stores and share authenticated control", async () => {
  for (const app of Object.values(APEX_APPS)) {
    const surface = app.id === "planet-apex" ? "planet-apex.html" : app.entry.slice(1);
    const page = await read("../public/" + surface);
    assert.doesNotMatch(page, /localStorage/, app.name + " must not trap app data in browser localStorage");
    assert.match(page, /api-auth-bridge\.js/, app.name + " must use the shared phone authorization bridge");
    assert.match(page, /sessionStorage/, app.name + " must keep browser session state temporary");
  }
});
