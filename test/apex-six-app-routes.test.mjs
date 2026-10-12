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
