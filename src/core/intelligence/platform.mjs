import { CapabilityRegistry } from "./capability-registry.mjs";
import { ProviderRouter } from "./provider-router.mjs";
import { EvidenceLedger } from "./evidence-ledger.mjs";
import { ExecutionGraph } from "./execution-graph.mjs";

export class ApexIntelligencePlatform {
  constructor({ capabilities = [], providers = [] } = {}) {
    this.capabilities = new CapabilityRegistry();
    this.providers = new ProviderRouter();
    this.evidence = new EvidenceLedger();
    for (const definition of capabilities) this.capabilities.register(definition);
    for (const definition of providers) this.providers.register(definition);
  }

  registerCapability(definition) { return this.capabilities.register(definition); }
  registerProvider(definition) { return this.providers.register(definition); }

  plan(work = {}) {
    const graph = new ExecutionGraph();
    const byName = new Map();
    const requests = Array.isArray(work.tasks) ? work.tasks : [];
    for (const task of requests) {
      const candidates = this.capabilities.resolve({
        capabilities: [task.capability],
        tags: task.tags,
        tools: task.tools,
        qualityWeight: task.qualityWeight,
        latencyWeight: task.latencyWeight,
        costWeight: task.costWeight
      });
      if (!candidates.length) throw new Error("No capability satisfies task: " + task.name);
      const node = graph.addNode({
        id: task.id,
        name: task.name,
        capability: candidates[0].name,
        input: task.input,
        maxAttempts: task.maxAttempts,
        metadata: { selectedCapabilityVersion: candidates[0].version, providerRequirements: task.providerRequirements ?? {} }
      });
      byName.set(task.name, node.id);
    }
    for (const task of requests) {
      const nodeId = byName.get(task.name);
      for (const dependency of task.dependsOn ?? []) graph.addDependency(nodeId, byName.get(dependency) ?? dependency);
    }
    return graph;
  }

  async execute(graph, { context = {}, verify = true, verifier, signal } = {}) {
    return graph.run(async (node, runContext) => {
      const capability = this.capabilities.get(node.capability);
      if (!capability) throw new Error("Capability disappeared: " + node.capability);
      const providerResult = node.metadata?.providerRequirements
        ? await this.providers.generate(node.input, { ...node.metadata.providerRequirements, capabilities: node.metadata.providerRequirements.capabilities ?? [] })
        : null;
      return capability.execute(node.input, {
        ...context, ...runContext, provider: providerResult, evidence: this.evidence
      });
    }, { verify, verifier, signal });
  }

  inspect() {
    return {
      capabilities: this.capabilities.list(),
      providers: this.providers.list(),
      evidenceRecords: this.evidence.records.size,
      evidenceClaims: this.evidence.claims.size
    };
  }
}

export function createApexIntelligencePlatform(options = {}) {
  return new ApexIntelligencePlatform(options);
}
