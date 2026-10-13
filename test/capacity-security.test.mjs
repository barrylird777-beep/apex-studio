import test from "node:test";
import assert from "node:assert/strict";

test("request limits and page sizes remain bounded even when deployment variables are oversized", async () => {
  const keys = ["APEX_JSON_BODY_LIMIT", "APEX_URLENCODED_BODY_LIMIT", "APEX_MAX_PAGE_SIZE", "APEX_JOB_CONCURRENCY", "APEX_PROVIDER_TIMEOUT_MS"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.APEX_JSON_BODY_LIMIT = "10gb";
    process.env.APEX_URLENCODED_BODY_LIMIT = "10gb";
    process.env.APEX_MAX_PAGE_SIZE = "999999999";
    process.env.APEX_JOB_CONCURRENCY = "999999999";
    process.env.APEX_PROVIDER_TIMEOUT_MS = "999999999";
    const { CAPACITY } = await import("../src/core/capacity.mjs?bounded-security-test");
    assert.equal(CAPACITY.jsonBody, "50mb");
    assert.equal(CAPACITY.urlencodedBody, "5mb");
    assert.equal(CAPACITY.maxPageSize, 1000);
    assert.equal(CAPACITY.jobConcurrency, 256);
    assert.equal(CAPACITY.providerTimeoutMs, 120000);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("malformed request-limit environment values fall back to safe defaults", async () => {
  const keys = ["APEX_JSON_BODY_LIMIT", "APEX_URLENCODED_BODY_LIMIT", "APEX_MAX_PAGE_SIZE"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    process.env.APEX_JSON_BODY_LIMIT = "unlimited";
    process.env.APEX_URLENCODED_BODY_LIMIT = "-4gb";
    process.env.APEX_MAX_PAGE_SIZE = "not-a-number";
    const { CAPACITY } = await import("../src/core/capacity.mjs?malformed-security-test");
    assert.equal(CAPACITY.jsonBody, "10mb");
    assert.equal(CAPACITY.urlencodedBody, "1mb");
    assert.equal(CAPACITY.maxPageSize, 100);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
