export class MultiAiCoordinator {
  constructor({ providers = {} } = {}) {
    this.providers = providers;
  }

  #validateText(value, label) {
    const text = String(value ?? '').trim();
    if (!text) throw new Error(label + ' returned an empty response');
    return text;
  }

  async run({ task, providers = ['gemini', 'claude'], system, context = {}, signal, synthesize = true } = {}) {
    const prompt = this.#validateText(task, 'Task');
    const requested = [...new Set(providers.map(String).map(v => v.toLowerCase()).filter(Boolean))];
    if (!requested.length) throw new Error('At least one AI provider is required');

    const results = await Promise.all(requested.map(async provider => {
      const adapter = this.providers[provider];
      if (!adapter) return { provider, ok: false, error: provider + ' provider unavailable' };
      const startedAt = Date.now();
      try {
        const text = this.#validateText(
          await adapter.generate(
            context && Object.keys(context).length
              ? prompt + '\n\nSHARED CONTEXT:\n' + JSON.stringify(context)
              : prompt,
            { system, signal }
          ),
          provider
        );
        return { provider, ok: true, model: adapter.model, text, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return { provider, ok: false, model: adapter.model, error: error instanceof Error ? error.message : String(error), latencyMs: Date.now() - startedAt };
      }
    }));

    const successful = results.filter(result => result.ok);
    if (!successful.length) {
      return { ok: false, stage: 'parallel', results, synthesis: null };
    }

    const synthesisProvider =
      this.providers.claude && results.find(r => r.provider === 'claude' && r.ok)
        ? 'claude'
        : successful[0].provider;

    const synthesizer = this.providers[synthesisProvider];
    const reviewPrompt =
      'SYNTHESIZE THESE AI REPORTS. Preserve verified facts, identify conflicts, discard unsupported claims, and produce one actionable engineering result. Do not invent missing information.\n\n' +
      results.filter(r => r.ok).map(r => 'PROVIDER: ' + r.provider + '\n' + r.text).join('\n\n');

    let synthesis = null;
    if (successful.length === 1 || synthesize === false) {
      const only = successful[0];
      synthesis = { provider: only.provider, model: only.model, text: only.text };
    } else {
      try {
        const synthesizedText = this.#validateText(
          await synthesizer.generate(reviewPrompt, {
            system: system || 'You are the Apex multi-AI synthesis layer. Return a concise, technically actionable result.',
            signal
          }),
          'Synthesis'
        );
        synthesis = { provider: synthesisProvider, model: synthesizer.model, text: synthesizedText };
      } catch {
        synthesis = null;
      }
    }

    return {
      ok: true,
      stage: 'complete',
      results,
      synthesis: synthesis ? { provider: synthesisProvider, model: synthesizer.model, text: synthesis } : null
    };
  }
}

export default MultiAiCoordinator;
