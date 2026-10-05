import crypto from "node:crypto";

const id = () => crypto.randomUUID();
const arr = v => Array.isArray(v) ? [...new Set(v.map(String))] : [];

export class ExecutionGraph {
  constructor() { this.nodes = new Map(); this.edges = new Map(); }

  addNode(input = {}) {
    if (!input.name) throw new TypeError("Execution node name is required");
    const node = {
      id: input.id ?? id(), name: String(input.name), capability: input.capability ?? null,
      input: input.input ?? null, status: "pending", attempts: 0, maxAttempts: Math.max(1, Number(input.maxAttempts ?? 3)),
      result: null, error: null, verification: null, metadata: input.metadata ?? {}
    };
    this.nodes.set(node.id, node); this.edges.set(node.id, new Set(arr(input.dependsOn)));
    return structuredClone(node);
  }

  addDependency(nodeId, dependencyId) {
    if (!this.nodes.has(nodeId) || !this.nodes.has(dependencyId)) throw new Error("Execution node not found");
    this.edges.get(nodeId).add(dependencyId); this.assertAcyclic(); return true;
  }

  assertAcyclic() {
    const visiting = new Set(), visited = new Set();
    const visit = id => {
      if (visiting.has(id)) throw new Error("Execution graph contains a dependency cycle");
      if (visited.has(id)) return;
      visiting.add(id); for (const dep of this.edges.get(id) ?? []) visit(dep);
      visiting.delete(id); visited.add(id);
    };
    for (const nodeId of this.nodes.keys()) visit(nodeId);
  }

  ready() {
    return [...this.nodes.values()].filter(n => n.status === "pending" &&
      [...(this.edges.get(n.id) ?? [])].every(dep => this.nodes.get(dep)?.status === "completed"));
  }

  async run(executor, { verify = true, verifier, signal } = {}) {
    this.assertAcyclic();
    while (true) {
      if (signal?.aborted) throw new Error("Execution aborted");
      const ready = this.ready();
      if (!ready.length) break;
      await Promise.all(ready.map(async node => {
        node.status = "running"; node.attempts++;
        try {
          node.result = await executor(node, { signal, graph: this });
          if (verify) {
            const verifyFn = typeof verifier === "function" ? verifier : executor.verify;
            if (typeof verifyFn !== "function") throw new Error("Independent verifier required for verified execution");
            node.verification = await verifyFn(node, { signal, graph: this });
            if (!node.verification?.passed) throw new Error("Verification failed for " + node.name);
          }
          node.status = "completed";
        } catch (error) {
          node.error = String(error?.message ?? error);
          node.status = node.attempts < node.maxAttempts ? "pending" : "failed";
          if (node.status === "failed") throw error;
        }
      }));
    }
    const failed = [...this.nodes.values()].filter(n => n.status === "failed");
    const blocked = [...this.nodes.values()].filter(n => n.status === "pending");
    return { passed: failed.length === 0 && blocked.length === 0, failed: failed.map(n => structuredClone(n)), blocked: blocked.map(n => structuredClone(n)), nodes: [...this.nodes.values()].map(n => structuredClone(n)) };
  }

  snapshot() {
    return { nodes: [...this.nodes.values()].map(n => structuredClone(n)), edges: [...this.edges.entries()].map(([k,v]) => [k,[...v]]) };
  }
}
