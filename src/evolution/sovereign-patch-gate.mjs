export class SovereignPatchGate {
  constructor({ profiler, activate = async () => { throw new Error('activation backend unavailable'); } } = {}) {
    this.profiler = profiler;
    this.activate = activate;
  }
  async evaluate(candidate) {
    const result = await this.profiler.validatePatch(candidate);
    return Object.freeze({ ...candidate, ...result });
  }
  async activateValidated(candidate) {
    if (!candidate?.validated || !candidate?.digest) throw new Error('unvalidated patch rejected');
    return this.activate(candidate);
  }
}
