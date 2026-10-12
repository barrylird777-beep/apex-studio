import { randomUUID } from "node:crypto";
import { apexPureStore } from "./apex-pure-store.mjs";

const EMPTY_STATE = Object.freeze({
  mission: null,
  activeWork: [],
  blockers: [],
  decisions: [],
  verifiedFacts: [],
  pendingVerification: [],
  recovery: null,
  metadata: {}
});

function cleanText(value, max = 10000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function json(value, fallback = {}) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
}

function stateCopy(value) {
  return { ...EMPTY_STATE, ...json(value) };
}

export function createPureWalChatRuntime({
  namespace = "apex",
  actor = "apex",
  store = apexPureStore
} = {}) {
  const prefix = cleanText(namespace, 80).replace(/[^a-zA-Z0-9_-]/g, "_") || "apex";
  const stateCollection = prefix + "_chat_runtime_state";
  const eventCollection = prefix + "_chat_runtime_events";

  async function getChatRuntimeState(scope = "default") {
    const key = cleanText(scope, 255) || "default";
    const row = await store.get(stateCollection, key);
    if (!row) return { durable: true, scope: key, state: stateCopy(), version: 0, updatedAt: null };
    return {
      durable: true,
      scope: key,
      state: stateCopy(row.state),
      version: Math.max(0, Number(row.version) || 0),
      updatedAt: row.updatedAt || null
    };
  }

  async function updateChatRuntimeState({
    scope = "default",
    patch = {},
    expectedVersion = null,
    actor: eventActor = actor
  } = {}) {
    const key = cleanText(scope, 255) || "default";
    const normalizedPatch = json(patch);
    return store.withMutationLock(async () => {
      const row = await store.get(stateCollection, key);
      const currentState = stateCopy(row?.state);
      const currentVersion = Math.max(0, Number(row?.version) || 0);
      if (expectedVersion != null && Number(expectedVersion) !== currentVersion) {
        const error = new Error("Chat runtime state version conflict");
        error.code = "RUNTIME_VERSION_CONFLICT";
        error.currentVersion = currentVersion;
        throw error;
      }
      const nextState = { ...currentState, ...normalizedPatch };
      const nextVersion = currentVersion + 1;
      const updatedAt = new Date().toISOString();
      await store.put(stateCollection, key, {
        scope: key,
        state: nextState,
        version: nextVersion,
        updatedAt
      });
      await store.create(eventCollection, {
        scope: key,
        eventType: "state.updated",
        payload: { patch: normalizedPatch, version: nextVersion },
        actor: cleanText(eventActor, 255) || actor,
        createdAt: updatedAt
      });
      return { durable: true, scope: key, state: nextState, version: nextVersion, updatedAt };
    });
  }

  async function recordChatRuntimeEvent({
    scope = "default",
    eventType = "runtime.event",
    payload = {},
    actor: eventActor = actor
  } = {}) {
    const id = randomUUID();
    const record = await store.create(eventCollection, {
      id,
      scope: cleanText(scope, 255) || "default",
      eventType: cleanText(eventType, 120) || "runtime.event",
      payload: json(payload),
      actor: cleanText(eventActor, 255) || actor,
      createdAt: new Date().toISOString()
    });
    return { durable: true, id: record.id };
  }

  async function listChatRuntimeEvents(scope = "default", limit = 50) {
    const key = cleanText(scope, 255) || "default";
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
    const events = await store.query(
      eventCollection,
      event => event.scope === key,
      {
        sort: (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
        limit: safeLimit
      }
    );
    return {
      durable: true,
      events: events.map(event => ({
        ...event,
        event_type: event.eventType,
        created_at: event.createdAt
      }))
    };
  }

  async function closeChatRuntimeStore() {
    // The shared Pure-WAL store is owned by the application runtime.
  }

  return {
    getChatRuntimeState,
    updateChatRuntimeState,
    recordChatRuntimeEvent,
    listChatRuntimeEvents,
    closeChatRuntimeStore
  };
}
