// @ts-check

/** Canonical capacity contract. Runtime workers remain bounded by these ceilings. */
export const APEX_LIMITS = Object.freeze({
  WORKER: Object.freeze({
    CONCURRENCY: 128,
    MAX_CONCURRENCY: 256,
    BATCH_SIZE: 128,
    MAX_BATCH_SIZE: 256,
    LEASE_TTL_SECONDS: 45,
    HEARTBEAT_INTERVAL_MS: 15000,
    DB_POOL_DEFAULT: 12,
    DB_POOL_MAX: 20,
  }),
  AI_CREW: Object.freeze({
    IN_MEMORY_CONCURRENCY: 64,
    MAX_CONCURRENCY_BOUND: 256,
    QUEUE_CAPACITY: 10000,
    MAX_QUEUE_CAPACITY: 20000,
    EMBEDDING_DIMENSION: 1536,
  }),
  GEMINI: Object.freeze({
    TIMEOUT_MS: 30000,
    RATE_BUCKET_CAPACITY: 10,
    REFILL_WINDOW_SECONDS: 60,
    MAX_RATE_LIMIT_WAIT_MS: 30000,
  }),
  TRANSPORT: Object.freeze({ MAX_JSON_BODY_BYTES: 10 * 1024 * 1024 }),
  MEDIA_QC: Object.freeze({
    EPISODE_MAX_DURATION_SECONDS: 3600,
    RESOLUTION: Object.freeze({ WIDTH: 1920, HEIGHT: 1080 }),
    MAX_BLACK_INTERVAL_SECONDS: 3,
    MAX_SILENCE_SECONDS: 5,
  }),
  INFRASTRUCTURE: Object.freeze({ NODE_VERSION: "22+", DATABASE: "PostgreSQL", VECTOR_INDEX: "pgvector/HNSW" }),
});

export default APEX_LIMITS;
