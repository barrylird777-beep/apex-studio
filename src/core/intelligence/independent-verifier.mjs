export class IndependentVerifier {
  constructor({ checks = [] } = {}) {
    this.checks = new Map();
    for (const check of checks) this.register(check);
  }

  register({ id, run, weight = 1 } = {}) {
    if (!id || typeof run !== "function") throw new TypeError("Verifier check requires id and run");
    this.checks.set(String(id), { id:String(id), run, weight:Math.max(0,Number(weight)||1) });
    return this;
  }

  async verify(target, context = {}) {
    if (!this.checks.size) throw new Error("No independent verification checks registered");
    const results = await Promise.all([...this.checks.values()].map(async check => {
      try {
        const result = await check.run(target, context);
        return { id:check.id, passed:result?.passed===true, weight:check.weight, detail:result };
      } catch (error) {
        return { id:check.id, passed:false, weight:check.weight, detail:{ error:String(error?.message||error) } };
      }
    }));
    const total=results.reduce((sum,r)=>sum+r.weight,0);
    const passed=results.reduce((sum,r)=>sum+(r.passed?r.weight:0),0);
    return { passed:total>0&&passed===total, verifier:"independent-verifier", checks:results, score:total?passed/total:0 };
  }
}
