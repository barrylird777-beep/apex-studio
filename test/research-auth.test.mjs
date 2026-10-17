import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createResearchRouter } from "../src/api/research-routes.mjs";

test("research API accepts a valid Authorization: Bearer token", async () => {
  const previous = process.env.APEX_RESEARCH_TOKEN;
  process.env.APEX_RESEARCH_TOKEN = "research-test-secret";
  const app = express();
  app.use(express.json());
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
  app.use(express.json());
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

test("syndication route awaits URL validation before handing URL to ingestion", async () => {
  const previous = process.env.APEX_RESEARCH_TOKEN;
  process.env.APEX_RESEARCH_TOKEN = "research-test-secret";
  let ingested;
  const app = express();
  app.use(express.json());
  app.use("/api/research", createResearchRouter({
    async resolveWork(query) { return { query }; },
    async ingestSyndication(url) {
      ingested = url;
      return { url };
    }
  }, {
    async validateUrl(rawUrl) {
      assert.equal(rawUrl, "https://feed.example/rss.xml");
      await Promise.resolve();
      return "https://feed.example/rss.xml";
    }
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/research/syndication`, {
      method: "POST",
      headers: {
        Authorization: "Bearer research-test-secret",
        "content-type": "application/json"
      },
      body: JSON.stringify({ url: "https://feed.example/rss.xml" })
    });
    assert.equal(response.status, 200);
    assert.equal(ingested, "https://feed.example/rss.xml");
    assert.deepEqual(await response.json(), { success: true, feed: { url: "https://feed.example/rss.xml" } });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.APEX_RESEARCH_TOKEN;
    else process.env.APEX_RESEARCH_TOKEN = previous;
  }
});
