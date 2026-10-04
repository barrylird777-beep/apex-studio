import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 3127;
const base = `http://127.0.0.1:${port}`;

async function waitForServer(proc) {
  const deadline = Date.now() + 15000;
  let output = "";
  proc.stdout.on("data", chunk => { output += chunk; });
  proc.stderr.on("data", chunk => { output += chunk; });
  while (Date.now() < deadline) {
    try { await fetch(base + "/api/projects"); return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error("server did not start: " + output);
}
async function json(path, options) {
  const r = await fetch(base + path, { ...options, headers: { "content-type": "application/json", ...(options?.headers || {}) } });
  const text = await r.text();
  return { r, body: text ? JSON.parse(text) : null };
}
test("SPEC-005 API smoke: calendar, day creation, assignment, order, unassign, auto-schedule", async () => {
  const server = spawn(process.execPath, ["--import", "tsx", "src/api/server.ts"], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore","pipe","pipe"] });
  try {
    await waitForServer(server);
    const project = await json("/api/projects", { method:"POST", body:JSON.stringify({title:"SPEC-005 smoke"}) });
    assert.equal(project.r.status,201);
    const id = project.body.id;
    for (const [n,location] of [["One","Camp"],["Two","Moriah"],["Three","Camp"]]) {
      const scene = await json(`/api/projects/${id}/scenes`, { method:"POST", body:JSON.stringify({sceneNumber:n==="One"?1:n==="Two"?2:3,title:n,scriptureRef:"Genesis 1:1",location,dayOrNight:"DAY",actionSummary:n}) });
      assert.equal(scene.r.status,201);
      if (!globalThis.__sceneIds) globalThis.__sceneIds = [];
      globalThis.__sceneIds.push(scene.body.id);
    }
    const before = await json(`/api/projects/${id}/calendar`, {method:"GET"});
    assert.equal(before.r.status,200);
    assert.equal(before.body.summary.unassigned,3);

    const d1 = await json(`/api/projects/${id}/shoot-days`, {method:"POST",body:JSON.stringify({shootDate:"2026-11-01",callTime:"07:00",notes:"Unit 1"})});
    const d2 = await json(`/api/projects/${id}/shoot-days`, {method:"POST",body:JSON.stringify({shootDate:"2026-11-02"})});
    assert.equal(d1.r.status,201); assert.equal(d2.r.status,201);
    const duplicate = await json(`/api/projects/${id}/shoot-days`, {method:"POST",body:JSON.stringify({shootDate:"2026-11-01"})});
    assert.equal(duplicate.r.status,409);
    const badDate = await json(`/api/projects/${id}/shoot-days`, {method:"POST",body:JSON.stringify({shootDate:"not-a-date"})});
    assert.equal(badDate.r.status,400);
    const sceneIds = globalThis.__sceneIds;
    assert.equal(sceneIds.length, 3);
    const assign = await json(`/api/shoot-days/${d1.body.id}/scenes`, {method:"POST",body:JSON.stringify({sceneIds:[sceneIds[0]]})});
    assert.equal(assign.r.status,200);
    const moved = await json(`/api/shoot-days/${d2.body.id}/scenes`, {method:"POST",body:JSON.stringify({sceneIds:[sceneIds[0]]})});
    assert.equal(moved.r.status,200);
    const afterMove = await json(`/api/projects/${id}/calendar`, {method:"GET"});
    assert.deepEqual(afterMove.body.days[0].scenes.map(s=>s.id),[]);
    assert.deepEqual(afterMove.body.days[1].scenes.map(s=>s.id),[sceneIds[0]]);
    const order = await json(`/api/shoot-days/${d2.body.id}/order`, {method:"PUT",body:JSON.stringify({sceneIds:[sceneIds[0]]})});
    assert.equal(order.r.status,200);
    const unassign = await fetch(base + `/api/scenes/${sceneIds[0]}/assignment`, {method:"DELETE"});
    assert.equal(unassign.status,204);
    const auto = await json(`/api/projects/${id}/auto-schedule`, {method:"POST",body:JSON.stringify({maxScenes:2})});
    assert.equal(auto.r.status,200);
    assert.equal(auto.body.summary.unassigned,0);
    const calendar = await json(`/api/projects/${id}/calendar`, {method:"GET"});
    assert.equal(calendar.r.status,200);
    assert.deepEqual(calendar.body.days.map(d=>d.shootDate),["2026-11-01","2026-11-02"]);
    assert.equal(calendar.body.summary.assigned,3);
    const deleted = await fetch(base + `/api/shoot-days/${d2.body.id}`, {method:"DELETE"});
    assert.equal(deleted.status,204);
    const afterDelete = await json(`/api/projects/${id}/calendar`, {method:"GET"});
    assert.equal(afterDelete.body.summary.unassigned,1);
    assert.equal(afterDelete.body.unassigned[0].id,sceneIds[1]);
  } finally {
    server.kill("SIGTERM");
  }
});
