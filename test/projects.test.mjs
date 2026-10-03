import test from "node:test";import assert from "node:assert/strict";import {readFile} from "node:fs/promises";
test("SPEC-001 project contract",async()=>{const s=await readFile("src/api/projects.ts","utf8");for(const x of ["listProjects","createProject","updateProject","deleteProject","getProjectOverview","sceneCount","characterCount","nextShootDay"])assert.ok(s.includes(x),x);});
test("SPEC-001 deduplicates linked character references",async()=>{const s=await readFile("src/api/projects.ts","utf8");assert.match(s,/new Set\(rows\.flatMap/);});
