const DEFAULT_NODES = [
  { id: "node-local", endpoint: "http://127.0.0.1:11434/api/generate", weight: 10, model: "" },
  { id: "node-lan-gpu", endpoint: "http://192.168.1.150:11434/api/generate", weight: 8, model: "" }
];

const number = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

function loadNodes() {
  const raw = process.env.APEX_SWARM_NODES;
  if (!raw) return DEFAULT_NODES.map(node => ({ ...node }));
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("APEX_SWARM_NODES must be an array");
    return parsed
      .filter(node => node?.id && node?.endpoint)
      .map(node => ({
        id: String(node.id),
        endpoint: String(node.endpoint),
        weight: number(node.weight, 1),
        model: node.model ? String(node.model) : ""
      }));
  } catch (error) {
    throw new Error("Invalid APEX_SWARM_NODES JSON: " + error.message);
  }
}

export class DecentralizedInferenceSwarm {
  constructor(options = {}) {
    this.swarmNodes = options.nodes?.length
      ? options.nodes.map(node => ({ ...node, weight: number(node.weight, 1) }))
      : loadNodes();
    this.timeoutMs = number(options.timeoutMs ?? process.env.APEX_SWARM_TIMEOUT_MS, 120000);
    this.cooldownMs = number(options.cooldownMs ?? process.env.APEX_SWARM_COOLDOWN_MS, 5000);
    this.cursor = 0;
    this.failures = new Map();
    this.inFlight = new Map();
  }

  availableNodes() {
    const now = Date.now();
    return this.swarmNodes.filter(node => (this.failures.get(node.id)?.until ?? 0) <= now);
  }

  selectOptimalNode() {
    const nodes = this.availableNodes();
    if (!nodes.length) throw new Error("[SWARM] No healthy inference nodes are available.");

    // Weighted deterministic selection. Avoids random routing and is easy to reproduce.
    let total = nodes.reduce((sum, node) => sum + node.weight, 0);
    let cursor = this.cursor++ % total;
    for (const node of nodes) {
      cursor -= node.weight;
      if (cursor < 0) return node;
    }
    return nodes[nodes.length - 1];
  }

  markFailure(node) {
    this.failures.set(node.id, {
      until: Date.now() + this.cooldownMs,
      count: (this.failures.get(node.id)?.count ?? 0) + 1
    });
  }

  markSuccess(node) {
    this.failures.delete(node.id);
  }

  async executeInference(prompt, modelName = "qwen3:8b", options = {}) {
    if (!String(prompt ?? "").trim()) throw new TypeError("[SWARM] Prompt is required.");
    if (!this.swarmNodes.length) throw new Error("[SWARM] No inference nodes configured.");

    const attempted = new Set();
    let lastError;

    while (attempted.size < this.swarmNodes.length) {
      const node = this.selectOptimalNode();
      if (attempted.has(node.id)) continue;
      attempted.add(node.id);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), number(options.timeoutMs, this.timeoutMs));

      try {
        const model = node.model || modelName;
        const response = await fetch(node.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt: String(prompt),
            stream: false,
            ...(options.parameters ? { options: options.parameters } : {})
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${node.id}`);
        }

        const data = await response.json();
        this.markSuccess(node);
        return {
          response: String(data.response ?? data.output ?? data.text ?? ""),
          nodeId: node.id,
          model,
          latencyMs: Date.now() - (timer.startedAt ?? Date.now())
        };
      } catch (error) {
        this.markFailure(node);
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error("[SWARM] All inference nodes failed: " + (lastError?.message || "unknown error"));
  }

  status() {
    const now = Date.now();
    return {
      nodeCount: this.swarmNodes.length,
      nodes: this.swarmNodes.map(node => {
        const failure = this.failures.get(node.id);
        return {
          id: node.id,
          endpoint: node.endpoint,
          weight: node.weight,
          healthy: !failure || failure.until <= now,
          cooldownUntil: failure?.until ?? null,
          failures: failure?.count ?? 0
        };
      })
    };
  }
}

export default DecentralizedInferenceSwarm;
