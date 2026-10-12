import { RemoteContentAddressedStore } from "../src/core/remote-content-addressed-store.mjs";
import { RemoteApexRingWAL } from "../src/core/remote-apex-ring-wal.mjs";
import { randomUUID } from "node:crypto";

const store = new RemoteContentAddressedStore();
const namespace = "system";
const serviceScope = String(process.env.RAILWAY_SERVICE_NAME || "apex").replace(/[^a-zA-Z0-9._:-]/g, "-").slice(0, 100);
const key = "provider-capability-probe-" + serviceScope;
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

  // Exercise the actual provider-backed remote WAL, not just its in-memory test double.
  // Use a throwaway scope and remove its references after readback so production data is untouched.
  const walScope = ("preflight-" + serviceScope + "-" + randomUUID()).slice(0, 100);
  const wal = new RemoteApexRingWAL({ cas: store, scope: walScope });
  const record = await wal.append("preflight.verify", { version: 1, nonce: randomUUID() });
  const reader = new RemoteApexRingWAL({ cas: store, scope: walScope });
  const snapshot = await reader.snapshot();
  if (snapshot.sequence !== 1 || snapshot.lastHash !== record.hash || snapshot.ring[0]?.hash !== record.hash) {
    throw new Error("Remote WAL append/readback/hash-chain verification failed");
  }
  const recordKey = walScope + "-r00000000000000000001";
  const storedRecord = await store.readRef("wal", recordKey);
  if (!storedRecord || storedRecord.value?.hash !== record.hash) {
    throw new Error("Remote WAL provider readback did not match the appended record");
  }
  await store.deleteRef("wal", recordKey, { expectedHash: storedRecord.hash });
  const headKey = "wal-head-" + walScope;
  const storedHead = await store.readRef("system", headKey);
  if (storedHead) await store.deleteRef("system", headKey, { expectedHash: storedHead.hash });
  console.log("[REMOTE_WAL_PREFLIGHT] provider-backed append/readback/hash-chain verified; probe refs removed");
} catch (error) {
  console.error("[REMOTE_CAS_PREFLIGHT] failed:", String(error?.message || error).slice(0, 300));
  throw error;
}
