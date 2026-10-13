import { createHash, randomUUID } from "node:crypto";
import { apexPureStore } from "./apex-pure-store.mjs";

const MAX_INPUT_BYTES = 64 * 1024;
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Generation data numbers must be finite.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Generation data must contain only plain JSON values.");
  }
  return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
}

function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/**
 * Stores structured generation data only. This deliberately does not render video,
 * build timelines, process audio, or write files to the service's local volume.
 * Durable writes require the remote content-addressed store and remote Ring-WAL.
 */
export function createSilentAssetCompiler({ store = apexPureStore, clock = () => new Date() } = {}) {
  if (!store || typeof store.put !== "function" || typeof store.get !== "function") {
    throw new TypeError("A compatible durable asset store is required.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  async function compile({ id = randomUUID(), kind = "generation-data", data, metadata = {} } = {}) {
    if (!store.remoteMode || !store.wal || typeof store.wal.append !== "function") {
      throw Object.assign(new Error("Silent asset compiler requires remote CAS storage and remote Ring-WAL; local-only mode is disabled."), {
        code: "REMOTE_STORAGE_REQUIRED"
      });
    }
    if (!ID_PATTERN.test(String(id)) || String(id).includes("..")) {
      throw Object.assign(new Error("Invalid asset id."), { code: "INVALID_ASSET_ID" });
    }
    if (!ID_PATTERN.test(String(kind)) || String(kind).includes("..")) {
      throw Object.assign(new Error("Invalid asset kind."), { code: "INVALID_ASSET_KIND" });
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.getPrototypeOf(data) !== Object.prototype) {
      throw Object.assign(new Error("Generation data must be a JSON object."), { code: "INVALID_GENERATION_DATA" });
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || Object.getPrototypeOf(metadata) !== Object.prototype) {
      throw Object.assign(new Error("Metadata must be a JSON object."), { code: "INVALID_METADATA" });
    }

    const source = { kind: String(kind), data, metadata };
    const sourceJson = canonical(source);
    const bytes = Buffer.byteLength(sourceJson, "utf8");
    if (bytes > MAX_INPUT_BYTES) {
      throw Object.assign(new Error("Generation data exceeds the 64 KiB limit."), { code: "GENERATION_DATA_TOO_LARGE", maxBytes: MAX_INPUT_BYTES, actualBytes: bytes });
    }

    const sourceHash = digest(source);
    await store.init?.();
    const existing = await store.get("silent_assets", String(id));
    if (existing && existing.sourceHash !== sourceHash) {
      throw Object.assign(new Error("Asset id already exists with different generation data."), { code: "ASSET_ID_CONFLICT" });
    }

    const now = clock().toISOString();
    const asset = existing || {
      id: String(id),
      kind: String(kind),
      status: "compiled",
      source,
      sourceHash,
      sourceBytes: bytes,
      compiler: "silent-asset-compiler/v1",
      createdAt: now
    };

    if (!existing) await store.put("silent_assets", String(id), asset);

    // A retry after a partial failure safely replays this same event key.
    const event = await store.wal.append("asset.compile.completed", {
      assetId: String(id),
      kind: String(kind),
      sourceHash,
      sourceBytes: bytes,
      compiler: "silent-asset-compiler/v1"
    }, { idempotencyKey: "silent-asset-compile:" + String(id) + ":" + sourceHash });

    return { asset: existing || asset, sourceHash, sourceBytes: bytes, walSequence: event.seq, duplicate: Boolean(existing) };
  }

  return { compile };
}

export const silentAssetCompiler = createSilentAssetCompiler();
export default silentAssetCompiler;
