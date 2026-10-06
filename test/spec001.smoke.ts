import assert from "node:assert/strict";
import { db } from "../src/db/index.ts";
import { characters, scenes, shootDays } from "../src/db/schema.ts";
import { createProject, deleteProject, getProjectOverview, listProjects, updateProject } from "../src/api/projects.ts";

const created = await createProject({ title: "SPEC-001 Smoke", primaryScripture: "Genesis 1", status: "development" });
assert.ok(created?.id);
const character = db.insert(characters).values({ canonicalName: "Smoke Character" }).run();
db.insert(scenes).values({ projectId: created.id, scriptureRef: "Genesis 1:1", charactersPresent: [Number(character.lastInsertRowid)] }).run();
db.insert(shootDays).values({ projectId: created.id, date: new Date(Date.now() + 86400000).toISOString().slice(0, 10), unit: "1st Unit" }).run();

let overview = await getProjectOverview(created.id);
assert.equal(overview?.sceneCount, 1);
assert.equal(overview?.characterCount, 1);
assert.ok(overview?.nextShootDay);

const updated = await updateProject(created.id, { title: "SPEC-001 Smoke Updated", primaryScripture: "Genesis 1:1", status: "pre-production" });
assert.equal(updated?.title, "SPEC-001 Smoke Updated");
assert.equal(updated?.status, "pre-production");
assert.equal((await listProjects()).some((p) => p.id === created.id), true);

await deleteProject(created.id);
assert.equal(await getProjectOverview(created.id), null);
assert.equal((await listProjects()).some((p) => p.id === created.id), false);

console.log("SPEC-001 CRUD/counts/empty-state smoke test passed");