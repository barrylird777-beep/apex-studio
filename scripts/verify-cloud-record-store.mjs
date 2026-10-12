import { randomUUID } from "node:crypto";
import { createCloudRecordStore } from "../src/storage/cloud-record-store.mjs";

const id = randomUUID();
const store = createCloudRecordStore({ namespace: "planetapex/healthcheck/v1" });
const record = { id, purpose: "storage-write-read-delete-recovery-probe", createdAt: new Date().toISOString() };
try {
  const written = await store.put("probe", id, record);
  const reread = await store.get("probe", id);
  const recoveredStore = createCloudRecordStore({ namespace: "planetapex/healthcheck/v1" });
  const recovered = await recoveredStore.get("probe", id);
  if (JSON.stringify(written) !== JSON.stringify(record) || JSON.stringify(reread) !== JSON.stringify(record) || JSON.stringify(recovered) !== JSON.stringify(record)) {
    throw new Error("Remote object read-after-write verification failed");
  }
  console.log(JSON.stringify({ ok: true, provider: store.provider, bucket: store.bucket, write: true, read: true, freshClientRecovery: true, integrity: true }));
} finally {
  await store.delete("probe", id);
  if (await store.get("probe", id) !== null) throw new Error("Remote delete verification failed");
}
console.log(JSON.stringify({ cleanup: true }));
