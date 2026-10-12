import test from "node:test";
import assert from "node:assert/strict";
import {
  listKashKornerOpportunities,
  normalizeOpportunity,
  opportunityEngineTokenMatches,
  saveKashKornerOpportunity
} from "../src/api/kash-korner-opportunities.mjs";

test("opportunity records get stable ids and normalized fields", () => {
  const a = normalizeOpportunity({ fingerprint: "chain-1:pool-a:pool-b", estimated_net_profit_usd: "3.75" });
  const b = normalizeOpportunity({ fingerprint: "chain-1:pool-a:pool-b", estimated_net_profit_usd: 4 });
  assert.equal(a.id, b.id);
  assert.equal(a.record.recordType, "opportunity");
  assert.equal(a.record.estimated_net_profit_usd, 3.75);
});

test("opportunity fingerprint is required", () => {
  assert.throws(() => normalizeOpportunity({}), /fingerprint is required/);
});

test("opportunity token check is timing-safe and fails closed for missing values", () => {
  assert.equal(opportunityEngineTokenMatches("secret", "secret"), true);
  assert.equal(opportunityEngineTokenMatches("secret", "wrong"), false);
  assert.equal(opportunityEngineTokenMatches("", "secret"), false);
  assert.equal(opportunityEngineTokenMatches("secret", ""), false);
});

test("KashKorner opportunity writes are durable and listing ranks net profit", async () => {
  const rows = new Map();
  const fabric = {
    async put(appId, id, record) {
      const result = { appId, id, record: { ...record, id }, durable: true, storage: "local-pure-wal" };
      rows.set(id, result);
      return result;
    },
    async list(appId) {
      assert.equal(appId, "kash-korner");
      return [...rows.values()];
    }
  };
  await saveKashKornerOpportunity(fabric, { fingerprint: "low", estimated_net_profit_usd: 1 });
  await saveKashKornerOpportunity(fabric, { fingerprint: "high", estimated_net_profit_usd: 10 });
  const listed = await listKashKornerOpportunities(fabric);
  assert.deepEqual(listed.map(row => row.fingerprint), ["high", "low"]);
  assert.ok(listed.every(row => row.recordType === "opportunity"));
});
