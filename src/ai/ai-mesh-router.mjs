import { log } from "../core/resilience/load-shedder.mjs";
import { createAiCircuitBreakerRegistry } from "../providers/ai-circuit-breaker.mjs";

function text(value, name) {
  const valueText = String(value ?? "").trim();
  if (!valueText) throw new TypeError(`${name} is required`);
  if (valueText.length > 2_000_000) throw new RangeError(`${name} is too large`);
  return valueText;
}

export class AIMeshRouter {
  constructor({ providers = {}, circuitBreakers = null, order = null } = {}) {
    this.providers = new Map(Object.entries(providers).map(([name, provider]) => [String(name).toLowerCase(), provider]));
    this.order = Array.isArray(order) && order.length
      ? order.map((name) => String(name).toLowerCase())
      : [...this.providers.keys()];
    this.breakers = circuitBreakers || createAiCircuitBreakerRegistry({
      failureThreshold: Number(process.env.APEX_AI_CIRCUIT_FAILURE_THRESHOLD || 5),
      resetTimeoutMs: Number(process.env.APEX_AI_CIRCUIT_RESET_MS || 10_000),
      maxResetTimeoutMs: Number(process.env.APEX_AI_CIRCUIT_MAX_RESET_MS || 120_000)
    });
  }

  getHealthyProviders() {
    return this.order
      .map((name) => [name, this.providers.get(name)])
      .filter(([, provider]) => provider && typeof provider.generate === "function")
      .filter(([name]) => {
        const state = this.breakers.get(name).getState();
        return state !== "OPEN";
      })
      .map(([name, provider]) => ({ name, provider, breaker: this.breakers.get(name) }));
  }

  async executeWithMesh(prompt, systemPrompt = "", options = {}) {
    const task = text(prompt, "prompt");
    const system = systemPrompt == null ? "" : String(systemPrompt);
    const candidates = this.getHealthyProviders();

    if (!candidates.length) {
      throw new Error("AI mesh has no configured healthy providers");
    }

    const errors = [];

    for (const { name, provider, breaker } of candidates) {
      try {
        log("info", "AI mesh dispatch", { provider: name });
        const result = await breaker.execute(() =>
          provider.generate(task, {
            ...options,
            ...(system ? { system } : {})
          })
        );

        const output = text(result, `${name} provider response`);
        return {
          provider: name,
          model: provider.model || null,
          output
        };
      } catch (error) {
        errors.push({
          provider: name,
          error: error instanceof Error ? error.message : String(error)
        });
        log("warn", "AI mesh provider failed", {
          provider: name,
          error: error instanceof Error ? error.message : String(error),
          circuit: breaker.snapshot()
        });
      }
    }

    const detail = errors.map((item) => `${item.provider}: ${item.error}`).join("; ");
    throw new Error(`AI mesh exhausted all providers: ${detail}`);
  }

  status() {
    return Object.fromEntries(
      this.order.map((name) => {
        const provider = this.providers.get(name);
        return [name, {
          configured: Boolean(provider && typeof provider.generate === "function"),
          model: provider?.model || null,
          circuit: this.breakers.get(name).snapshot()
        }];
      })
    );
  }
}

export default AIMeshRouter;
