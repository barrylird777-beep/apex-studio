import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { APEX_APPS } from "../src/apps/apex-six-apps.mjs";

const readPublic = file => readFile(resolve(process.cwd(), "public", file), "utf8");
const readSource = file => readFile(resolve(process.cwd(), file), "utf8");
const canonicalNames = ["KernelVision", "XShield", "Kernelodies", "PlanetApeX", "KashKorner", "KoinKob"];

test("all six canonical app surfaces expose working cross-app navigation", async () => {
  for (const app of Object.values(APEX_APPS)) {
    const file = app.entry === "/" ? "index.html" : app.entry.slice(1);
    const html = await readPublic(file);
    const nav = html.match(/<nav class="apex-app-nav"[^>]*>[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav, app.name + " must expose the canonical app navigation");
    for (const name of canonicalNames) assert.ok(nav.includes(name), app.name + " is missing navigation for " + name);
  }
});

test("every static app-page button has a corresponding script reference", async () => {
  for (const app of Object.values(APEX_APPS)) {
    const file = app.entry === "/" ? "index.html" : app.entry.slice(1);
    const html = await readPublic(file);
    const scriptSources = [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)]
      .map(match => match[1])
      .filter(src => src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/api/"));
    const scripts = await Promise.all(scriptSources.map(async src => {
      try { return await readPublic(src.slice(1)); } catch { return ""; }
    }));
    const source = html + "\n" + scripts.join("\n");
    const buttonTags = [...html.matchAll(/<button\b[^>]*>/gi)].map(match => match[0]);
    for (const tag of buttonTags) {
      const id = tag.match(/\bid=["']([^"']+)["']/i)?.[1];
      if (!id || /onclick=/i.test(tag)) continue;
      const escaped = id.replaceAll("-", "\\-");
      const referenced = new RegExp("(?:getElementById|querySelector|querySelectorAll)\\(\\s*['\"]#?" + escaped + "['\"]\\s*\\)|\\$\\(\\s*['\"]" + escaped + "['\"]\\s*\\)|\\[['\"]" + escaped + "['\"]\\]").test(source);
      assert.ok(referenced, app.name + " button #" + id + " has no script reference");
    }
  }
});

test("dashboard browser Back and Forward events update the active page", async () => {
  const app = await readSource("src/App.tsx");
  assert.match(app, /addEventListener\("popstate",\s*syncFromHistory\)/);
  assert.match(app, /removeEventListener\("popstate",\s*syncFromHistory\)/);
  assert.match(app, /pageForPath\(location\.pathname\)/);
});

test("project dashboard reports failed mutations and prevents duplicate submissions", async () => {
  const page = await readSource("src/pages/ProjectDashboard.tsx");
  assert.match(page, /Unable to load projects \(HTTP/);
  assert.match(page, /Unable to \$\{editing\?"save":"create"\} project/);
  assert.match(page, /Unable to delete project/);
  assert.match(page, /disabled=\{saving\}/);
  assert.match(page, /role="alert"/);
});

test("main dashboard tabs resolve to real views and network settings refresh is wired", async () => {
  const html = await readPublic("index.html");
  const buttons = [...html.matchAll(/<button\b[^>]*data-view=["']([^"']+)["'][^>]*>/gi)];
  assert.ok(buttons.length >= 15, "main dashboard should expose its existing workspaces");
  const sectionIds = new Set([...html.matchAll(/<(?:section|div)\b[^>]*id=["']([^"']+)["']/gi)].map(match => match[1]));
  for (const match of buttons) {
    const view = match[1];
    assert.ok(sectionIds.has(view), "dashboard tab " + view + " has no matching view container");
    assert.match(match[0], /onclick=["']view\(/i, "dashboard tab " + view + " must call the view switcher");
  }
  assert.match(html, /<h1>Network Settings<\/h1>/);
  assert.match(html, /onclick=["']loadNetwork\(\)["']/);
  assert.match(html, /async function loadNetwork\(\)/);
  assert.match(html, /api\(["']\/api\/network\/status["']\)/);
});

test("React dashboards and utility pages wire every button to an action or form", async () => {
  const pages = [
    "src/App.tsx",
    "src/pages/SixAppHub.tsx",
    "src/pages/ProjectDashboard.tsx",
    "src/pages/NetworkDashboard.tsx",
    "src/pages/LocalAI.tsx",
    "src/pages/SceneList.tsx",
    "src/pages/CharacterDatabase.tsx",
    "src/pages/ScriptureBreakdown.tsx"
  ];
  for (const path of pages) {
    const source = await readSource(path);
    const tags = [...source.matchAll(/<(?:Button|button)\b[^>]*>/g)].map(match => match[0]);
    const unwired = tags.filter(tag => !/onClick\s*=|onclick\s*=|type\s*=\s*["']submit["']|disabled\s*(?:=|\s|>)/i.test(tag));
    assert.deepEqual(unwired, [], path + " contains a button without an action, form submit, or intentional disabled state");
  }
});

test("shared controls drawer and display settings are attached to all six apps", async () => {
  const controls = await readPublic("apex-ui-controls.js");
  const styles = await readPublic("apex-ui-controls.css");
  for (const app of Object.values(APEX_APPS)) {
    const file = app.entry === "/" ? "index.html" : app.entry.slice(1);
    const html = await readPublic(file);
    assert.match(html, /apex-ui-controls\.css/, app.name + " must load shared controls styling");
    assert.match(html, /apex-ui-controls\.js/, app.name + " must load shared controls behavior");
  }
  assert.match(controls, /addToggle\("Higher contrast", "apex-ui-high-contrast"/);
  assert.match(controls, /addToggle\("Compact spacing", "apex-ui-compact"/);
  assert.match(controls, /event\.key === "Escape"/);
  assert.match(controls, /event\.shiftKey/);
  assert.match(controls, /priorFocus\.focus\(\)/);
  assert.match(styles, /body\.apex-ui-high-contrast/);
  assert.match(styles, /body\.apex-ui-compact/);
});

test("XShield failure states remain unavailable and are announced accessibly", async () => {
  const page = await readPublic("xshield.html");
  assert.match(page, /networkResponse\.ok&&network\.enabled===true/);
  assert.match(page, /networkResponse\.ok&&network\.enabled===false/);
  assert.ok(page.includes("id=\"appState\" class=\"metric\" role=\"status\" aria-live=\"polite\""));
  assert.ok(page.includes("id=\"networkState\" class=\"metric\" role=\"status\" aria-live=\"polite\""));
  assert.ok(page.includes("document.getElementById('networkState').textContent='UNAVAILABLE'"));
});

test("PlanetApeX and Kernelodies lead with their canonical primary jobs", async () => {
  const hub = await readSource("src/pages/SixAppHub.tsx");
  assert.match(hub, /const active = visibleApps\.find/);
  assert.match(hub, /useEffect\(\(\) => \{/);
  assert.match(hub, /setActiveKey\(visibleApps\[0\]\.key\)/);
  const planet = await readPublic("planet-apex.html");
  assert.match(planet, /aria-label="PlanetApeX study and research"/);
  assert.ok(planet.includes('href="/bible-study-room.html"'));
  assert.ok(planet.includes('href="/garden-of-apex.html"'));
  assert.ok(planet.includes('href="/special-search.html"'));
  const music = await readPublic("kernelodies.html");
  assert.match(music, /Listen, discover, and build your music library/);
  assert.match(music, /id="kernelodies-discovery"/);
});

test("XShield tabs switch panels and support keyboard navigation", async () => {
  const page = await readPublic("xshield.html");
  assert.ok(page.includes('id="xshield-tab-overview"'));
  assert.ok(page.includes('id="xshield-tab-diagnostics"'));
  assert.ok(page.includes('id="xshield-panel-overview"'));
  assert.ok(page.includes('id="xshield-panel-diagnostics"'));
  assert.match(page, /function selectXShieldTab\(which\)/);
  assert.match(page, /tabOverview\.addEventListener\('click'/);
  assert.match(page, /tabDiagnostics\.addEventListener\('click'/);
  assert.match(page, /event\.key==='ArrowRight'\|\|event\.key==='ArrowLeft'/);
});
