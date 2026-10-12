import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const port = 3127;
const base = `http://127.0.0.1:${port}`;
const controlToken = "schedule-smoke-test-token";

async function waitForServer(proc) {
  const deadline = Date.now() + 20000;
  let output = "";
  proc.stdout.on("data", chunk => { output += chunk; });
  proc.stderr.on("data", chunk => { output += chunk; });
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error("server exited before startup: " + output);
    try {
      const response = await fetch(base + "/health");
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("server did not start: " + output);
}
async function json(route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-apex-control-token": controlToken,
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  return { r: response, body: text ? JSON.parse(text) : null };
}

test("SPEC-005 sovereign API smoke: calendar, day creation, assignment, order, unassign, auto-schedule", async t => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "apex-schedule-smoke-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const storageDir = path.join(tempRoot, "storage");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    APEX_CONTROL_TOKEN: controlToken,
    APEX_SHORTCUT_TOKEN: controlToken,
    APEX_PROJECTS_DIR: path.join(tempRoot, "projects"),
    APEX_WAL_DIR: path.join(tempRoot, "wal"),
    APEX_SE_X_ROOT: tempRoot,
    APEX_STORAGE_DIR: storageDir,
    STORAGE_DIR: storageDir,
    APEX_MEDIA_DIR: path.join(tempRoot, "media"),
    APEX_ARTIFACTS_DIR: path.join(tempRoot, "artifacts"),
    APEX_ALLOW_ALL_CORS: "true"
  };
  const server = spawn(process.execPath, ["server.mjs"], { env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await waitForServer(server);
    const project = await json("/api/projects", { method: "POST", body: JSON.stringify({ title: "SPEC-005 smoke" }) });
    assert.equal(project.r.status, 201);
    const id = project.body.id;
    const sceneIds = [];
    for (const [n, location] of [["One", "Camp"], ["Two", "Moriah"], ["Three", "Camp"]]) {
      const scene = await json(`/api/projects/${id}/scenes`, {
        method: "POST",
        body: JSON.stringify({ sceneNumber: n === "One" ? 1 : n === "Two" ? 2 : 3, title: n, scriptureRef: "Genesis 1:1", location, dayOrNight: "DAY", actionSummary: n })
      });
      assert.equal(scene.r.status, 201);
      sceneIds.push(scene.body.id);
    }
    const before = await json(`/api/projects/${id}/calendar`, { method: "GET" });
    assert.equal(before.r.status, 200);
    assert.equal(before.body.summary.unassigned, 3);

    const [firstAttempt, secondAttempt] = await Promise.all([
      json(`/api/projects/${id}/shoot-days`, { method: "POST", body: JSON.stringify({ shootDate: "2026-11-01", callTime: "07:00", notes: "Unit 1" }) }),
      json(`/api/projects/${id}/shoot-days`, { method: "POST", body: JSON.stringify({ shootDate: "2026-11-01", callTime: "07:00", notes: "Unit 1" }) })
    ]);
    const d1 = firstAttempt.r.status === 201 ? firstAttempt : secondAttempt;
    const duplicate = firstAttempt.r.status === 409 ? firstAttempt : secondAttempt;
    assert.equal(d1.r.status, 201);
    assert.equal(duplicate.r.status, 409);
    const d2 = await json(`/api/projects/${id}/shoot-days`, { method: "POST", body: JSON.stringify({ shootDate: "2026-11-02" }) });
    assert.equal(d2.r.status, 201);
    const badDate = await json(`/api/projects/${id}/shoot-days`, { method: "POST", body: JSON.stringify({ shootDate: "not-a-date" }) });
    assert.equal(badDate.r.status, 400);
    assert.equal(sceneIds.length, 3);

    const assign = await json(`/api/shoot-days/${d1.body.id}/scenes`, { method: "POST", body: JSON.stringify({ sceneIds: [sceneIds[0]] }) });
    assert.equal(assign.r.status, 200);
    const moved = await json(`/api/shoot-days/${d2.body.id}/scenes`, { method: "POST", body: JSON.stringify({ sceneIds: [sceneIds[0]] }) });
    assert.equal(moved.r.status, 200);
    const afterMove = await json(`/api/projects/${id}/calendar`, { method: "GET" });
    assert.deepEqual(afterMove.body.days[0].scenes.map(scene => scene.id), []);
    assert.deepEqual(afterMove.body.days[1].scenes.map(scene => scene.id), [sceneIds[0]]);

    const order = await json(`/api/shoot-days/${d2.body.id}/order`, { method: "PUT", body: JSON.stringify({ sceneIds: [sceneIds[0]] }) });
    assert.equal(order.r.status, 200);
    const unassign = await fetch(base + `/api/scenes/${sceneIds[0]}/assignment`, { method: "DELETE", headers: { "x-apex-control-token": controlToken } });
    assert.equal(unassign.status, 204);

    const auto = await json(`/api/projects/${id}/auto-schedule`, { method: "POST", body: JSON.stringify({ maxScenes: 2 }) });
    assert.equal(auto.r.status, 200);
    assert.equal(auto.body.summary.unassigned, 0);
    const calendar = await json(`/api/projects/${id}/calendar`, { method: "GET" });
    assert.equal(calendar.r.status, 200);
    assert.deepEqual(calendar.body.days.map(day => day.shootDate), ["2026-11-01", "2026-11-02"]);
    assert.equal(calendar.body.summary.assigned, 3);

    const deleted = await fetch(base + `/api/shoot-days/${d2.body.id}`, { method: "DELETE", headers: { "x-apex-control-token": controlToken } });
    assert.equal(deleted.status, 204);
    const afterDelete = await json(`/api/projects/${id}/calendar`, { method: "GET" });
    assert.equal(afterDelete.body.summary.unassigned, 1);
    assert.equal(afterDelete.body.unassigned[0].id, sceneIds[1]);
  } finally {
    const exited = server.exitCode !== null ? Promise.resolve() : once(server, "exit").catch(() => {});
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 5000))]);
    if (server.exitCode === null) server.kill("SIGKILL");
  }
});
