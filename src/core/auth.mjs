import crypto from "node:crypto";

export class LocalAuth {
  constructor() {
    this.sessions = new Map();
  }

  issue(subject = "local-operator") {
    const token = crypto.randomBytes(32).toString("base64url");
    this.sessions.set(token, { subject: String(subject), createdAt: new Date().toISOString() });
    return token;
  }

  verify(token) {
    const session = this.sessions.get(String(token));
    return session ? { ...session } : null;
  }

  revoke(token) { return this.sessions.delete(String(token)); }
  clear() { this.sessions.clear(); }
}
