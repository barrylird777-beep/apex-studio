import { RemoteContentAddressedStore } from "../src/core/remote-content-addressed-store.mjs";

const store = new RemoteContentAddressedStore();
const namespace = "system";
const key = "provider-capability-probe";
const value = { probe: "apex-remote-cas-v1", version: 1 };
let ref = await store.readRef(namespace, key);

try {
  ref = await store.writeRef(namespace, key, value, { expectedHash: ref?.hash ?? null });
  const created = await store.readRef(namespace, key);
  if (!created || created.hash !== ref.hash || JSON.stringify(created.value) !== JSON.stringify(value)) {
    throw new Error("Remote CAS read-after-write verification failed");
  }

  ref = await store.writeRef(namespace, key, value, { expectedHash: created.hash });
  const updated = await store.readRef(namespace, key);
  if (!updated || updated.hash !== ref.hash || JSON.stringify(updated.value) !== JSON.stringify(value)) {
    throw new Error("Remote CAS conditional-update verification failed");
  }

  const deleted = await store.deleteRef(namespace, key, { expectedHash: updated.hash });
  if (!deleted || await store.readRef(namespace, key)) {
    throw new Error("Remote CAS conditional-delete verification failed");
  }
  console.log("[REMOTE_CAS_PREFLIGHT] conditional create/update/readback/delete verified");
} catch (error) {
  console.error("[REMOTE_CAS_PREFLIGHT] failed:", String(error?.message || error).slice(0, 300));
  throw error;
}
