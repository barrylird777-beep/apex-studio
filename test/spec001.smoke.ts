import assert from "node:assert/strict";
import { createCharacter } from "../src/api/characters.ts";
import { createScene } from "../src/api/scenes.ts";
import { createShootDay } from "../src/api/schedule.ts";
import { createProject, deleteProject, getProjectOverview, listProjects, updateProject } from "../src/api/projects.ts";

const created = await createProject({ title: "SPEC-001 Smoke", primaryScripture: "Genesis 1", status: "development" });
assert.ok(created?.id);

const character = await createCharacter({ canonicalName: "Smoke Character" });
assert.ok(character?.id);

const scene = await createScene({
  projectId: created.id,
  scriptureRef: "Genesis 1:1",
  charactersPresent: [character.id],
});
assert.ok(scene?.id);

const shootDay = await createShootDay({
  projectId: created.id,
  shootDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
});
assert.ok(shootDay?.id);

let overview = await getProjectOverview(created.id);
assert.equal(overview?.sceneCount, 1);
assert.equal(overview?.characterCount, 1);
assert.ok(overview?.nextShootDay);

const updated = await updateProject(created.id, {
  title: "SPEC-001 Smoke Updated",
  primaryScripture: "Genesis 1:1",
  status: "pre-production",
});
assert.equal(updated?.title, "SPEC-001 Smoke Updated");
assert.equal(updated?.status, "pre-production");
assert.equal((await listProjects()).some((p) => p.id === created.id), true);

assert.equal(await deleteProject(created.id), true);
assert.equal(await getProjectOverview(created.id), null);
assert.equal((await listProjects()).some((p) => p.id === created.id), false);

console.log("SPEC-001 CRUD/counts/empty-state smoke test passed");
