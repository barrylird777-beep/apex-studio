import { uid, now } from "./id.mjs";

export class MatureRuntimeBoundary {
  constructor(mature) {
    if (!mature) throw new Error("Mature content manager is required");
    this.mature = mature;
    this.sessions = new Map();
  }

  open(input = {}) {
    const { token, projectId = null, category = "mature-themes", mediaType = "script" } = input;
    this.mature.requireUnlocked(token);
    const access = this.mature.canAccess({ projectId, category, mediaType });
    if (!access.allowed) throw new Error(access.reason);
    const session = {
      id: uid("mature-runtime"),
      projectId,
      category,
      mediaType,
      state: "active",
      openedAt: now()
    };
    this.sessions.set(session.id, session);
    this.mature.record("runtime.session.opened", {
      sessionId: session.id,
      projectId,
      category,
      mediaType
    });
    return session;
  }

  close(sessionId, token) {
    this.mature.requireUnlocked(token);
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Mature runtime session not found");
    if (session.state === "active") {
      session.state = "closed";
      session.closedAt = now();
      this.mature.record("runtime.session.closed", { sessionId });
    }
    return session;
  }

  list(token) {
    this.mature.requireUnlocked(token);
    return [...this.sessions.values()];
  }

  snapshot() {
    return { sessions: [...this.sessions.values()] };
  }

  restore(snapshot = {}) {
    for (const session of snapshot.sessions ?? []) this.sessions.set(session.id, session);
    return this;
  }
}
