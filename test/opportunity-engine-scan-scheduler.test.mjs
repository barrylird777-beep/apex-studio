import test from "node:test";
import assert from "node:assert/strict";
import { triggerOpportunityScan, startOpportunityEngineScanScheduler } from "../src/core/opportunity-engine-scan-scheduler.mjs";

test("Opportunity Engine trigger sends bearer auth and accepts a successful scan", async () => {
  let received;
  const result = await triggerOpportunityScan({
    url: "https://engine.example/api/scan", token: "test-token", timeoutMs: 1000,
    fetchImpl: async (url, options) => {
      received = { url, options };
      return { ok: true, status: 200, json: async () => ({ status: "ok", opportunities: 4 }) };
    }
  });
  assert.equal(received.url, "https://engine.example/api/scan");
  assert.equal(received.options.method, "POST");
  assert.equal(received.options.headers.authorization, "Bearer test-token");
  assert.equal(result.ok, true);
  assert.equal(result.scanner.opportunities, 4);
});

test("Opportunity Engine trigger fails closed for partial configuration and non-2xx responses", async () => {
  await assert.rejects(() => triggerOpportunityScan({ url: "https://engine.example/api/scan", token: "" }), /both be configured/);
  await assert.rejects(() => triggerOpportunityScan({ url: "https://engine.example/api/scan", token: "secret", fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({}) }) }), /HTTP 401/);
});

test("scheduler stays disabled when no scan endpoint is configured", () => {
  const scheduler = startOpportunityEngineScanScheduler({ url: "", token: "", runImmediately: false });
  assert.equal(scheduler.enabled, false);
  scheduler.stop();
});
