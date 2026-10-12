import test from "node:test";
import assert from "node:assert/strict";
import { cloudStorageStatus } from "../src/storage/cloud-object-store.mjs";

test("cloud configuration is not misreported as verified or authoritative", () => {
  const keys = {
    APEX_OBJECT_STORAGE_ENDPOINT: "https://storage.example.invalid",
    APEX_OBJECT_STORAGE_BUCKET: "test-bucket",
    APEX_OBJECT_STORAGE_REGION: "auto",
    APEX_OBJECT_STORAGE_ACCESS_KEY_ID: "test-access-key",
    APEX_OBJECT_STORAGE_SECRET_ACCESS_KEY: "test-secret-key"
  };
  const previous = Object.fromEntries(Object.keys(keys).map(key => [key, process.env[key]]));
  Object.assign(process.env, keys);
  try {
    const status = cloudStorageStatus();
    assert.equal(status.configured, true);
    assert.equal(status.connectivityVerified, false);
    assert.equal(status.writeReadVerified, false);
    assert.equal(status.authoritativeForCoreStore, false);
    assert.match(status.note, /not a connectivity test/i);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
