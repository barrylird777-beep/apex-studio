import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createResearchRouter } from "../src/api/research-routes.mjs";

test("research API accepts a valid Authorization: Bearer token", async () => {
  const previous = process.env.APEX_RESEARCH_TOKEN;
  process.env.APEX_RESEARCH_TOKEN = "research-test-secret";
  const app = express();
  app.use("/api/research", createResearchRouter({
    async resolveWork(query) { return { query }; }
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/research/resolve?q=ancient+manuscripts`, {
      headers: { Authorization: "Bearer research-test-secret" }
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, work: { query: "ancient manuscripts" } });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.APEX_RESEARCH_TOKEN;
    else process.env.APEX_RESEARCH_TOKEN = previous;
  }
});

test("research API rejects an incorrect bearer token", async () => {
  const previous = process.env.APEX_RESEARCH_TOKEN;
  process.env.APEX_RESEARCH_TOKEN = "research-test-secret";
  const app = express();
  app.use("/api/research", createResearchRouter({
    async resolveWork(query) { return { query }; }
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/research/resolve?q=test`, {
      headers: { Authorization: "Bearer wrong-secret" }
    });
    assert.equal(response.status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.APEX_RESEARCH_TOKEN;
    else process.env.APEX_RESEARCH_TOKEN = previous;
  }
});
