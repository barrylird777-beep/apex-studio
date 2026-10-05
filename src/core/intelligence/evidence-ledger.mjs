import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const arr = v => Array.isArray(v) ? v : [];

export class EvidenceLedger {
  constructor() { this.records = new Map(); this.claims = new Map(); }

  record(input = {}) {
    if (!input.sourceRef && !input.artifactRef) throw new TypeError("Evidence requires sourceRef or artifactRef");
    const record = {
      id: input.id ?? id(), claimId: input.claimId ?? null,
      sourceRef: input.sourceRef ?? null, artifactRef: input.artifactRef ?? null,
      locator: input.locator ?? null, excerpt: input.excerpt ?? null,
      provenance: input.provenance ?? null, kind: input.kind ?? "source",
      confidence: Math.max(0, Math.min(1, Number(input.confidence ?? 0.5))),
      createdAt: new Date().toISOString(), metadata: input.metadata ?? {}
    };
    this.records.set(record.id, record);
    if (record.claimId) {
      if (!this.claims.has(record.claimId)) this.claims.set(record.claimId, []);
      this.claims.get(record.claimId).push(record.id);
    }
    return structuredClone(record);
  }

  claim(input = {}) {
    if (!input.statement) throw new TypeError("Claim statement is required");
    const claim = {
      id: input.id ?? id(), statement: String(input.statement),
      status: input.status ?? "unverified", confidence: Number(input.confidence ?? 0),
      evidenceIds: [], contradictions: arr(input.contradictions),
      createdAt: new Date().toISOString()
    };
    this.claims.set(claim.id, []);
    return claim;
  }

  attachEvidence(claimId, evidence) {
    if (!this.claims.has(claimId)) throw new Error("Claim not found: " + claimId);
    const e = this.record({ ...evidence, claimId });
    const ids = this.claims.get(claimId); ids.push(e.id);
    return e;
  }

  evaluateClaim(claim) {
    const ids = this.claims.get(claim.id) ?? [];
    const evidence = ids.map(id => this.records.get(id)).filter(Boolean);
    const support = evidence.reduce((n,e) => n + e.confidence, 0);
    const confidence = evidence.length ? Math.min(1, support / evidence.length) : 0;
    const contradictions = arr(claim.contradictions);
    return { ...structuredClone(claim), evidenceIds: ids, confidence, status: contradictions.length ? "contested" : confidence >= 0.8 ? "verified" : evidence.length ? "supported" : "unverified" };
  }

  getEvidence(id) { return structuredClone(this.records.get(id) ?? null); }
  listClaimEvidence(claimId) { return (this.claims.get(claimId) ?? []).map(id => this.records.get(id)).filter(Boolean).map(structuredClone); }
}
