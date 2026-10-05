import crypto from "node:crypto";

const arr = value => Array.isArray(value) ? value : [];
const now = () => new Date().toISOString();
const id = prefix => `${prefix}_${crypto.randomUUID()}`;

export const CAPABILITY_CLASSES = Object.freeze([
  "research","reasoning","coding","creative","media","knowledge","operations","verification"
]);

export const DEFAULT_CAPABILITIES = Object.freeze([
  { id:"research", domains:["research","analysis","fact-checking","provenance"], risk:"low" },
  { id:"reasoning", domains:["planning","analysis","synthesis","decision-support"], risk:"medium" },
  { id:"coding", domains:["software","debugging","architecture","testing","database","security"], risk:"high" },
  { id:"creative", domains:["writing","story","visual-direction","audio-direction"], risk:"medium" },
  { id:"media", domains:["image","video","audio","captions","render"], risk:"medium" },
  { id:"knowledge", domains:["scripture","history","genealogy","chronology","world-knowledge"], risk:"medium" },
  { id:"operations", domains:["automation","deployment","monitoring","recovery","infrastructure"], risk:"high" },
  { id:"verification", domains:["qa","evaluation","security","compliance","release"], risk:"high" }
]);

export class CapabilityKernel {
  constructor({ capabilities=DEFAULT_CAPABILITIES, planner=null, executor=null, verifier=null }={}) {
    this.capabilities = new Map();
    for (const capability of capabilities) this.registerCapability(capability);
    this.planner = planner;
    this.executor = executor;
    this.verifier = verifier;
  }

  registerCapability(capability) {
    if (!capability || typeof capability.id !== "string" || !capability.id.trim()) {
      throw new TypeError("Capability requires a non-empty id");
    }
    const normalized = {
      id: capability.id.trim(),
      domains: [...new Set(arr(capability.domains).map(String))],
      risk: capability.risk || "medium",
      description: capability.description || "",
      requiresApproval: capability.requiresApproval === true,
      metadata: capability.metadata || {}
    };
    this.capabilities.set(normalized.id, Object.freeze(normalized));
    return this;
  }

  listCapabilities() {
    return [...this.capabilities.values()].map(x => ({...x, domains:[...x.domains]}));
  }

  resolve(request={}) {
    const domains = [...new Set(arr(request.domains).map(String).filter(Boolean))];
    const explicit = arr(request.capabilities).map(String).filter(x => this.capabilities.has(x));
    const selected = explicit.length
      ? explicit
      : [...this.capabilities.values()]
          .filter(cap => !domains.length || domains.some(d => cap.id === d || cap.domains.includes(d)))
          .map(cap => cap.id);

    return [...new Set(selected)].map(id => this.capabilities.get(id)).filter(Boolean);
  }

  plan(request={}) {
    const goal = String(request.goal ?? request.task ?? "").trim();
    if (!goal) throw new Error("Capability request requires a goal");

    const selected = this.resolve(request);
    const work = selected.filter(x => x.id !== "verification");
    const verification = this.capabilities.get("verification");

    const tasks = work.map(capability => ({
      id:id("task"),
      capability:capability.id,
      goal,
      dependsOn:[],
      risk:capability.risk,
      requiresApproval:capability.requiresApproval || capability.risk === "high",
      status:"planned"
    }));

    if (verification) {
      tasks.push({
        id:id("task"),
        capability:"verification",
        goal,
        dependsOn:tasks.map(task => task.id),
        risk:"high",
        requiresApproval:false,
        status:"planned"
      });
    }

    return {
      id:id("plan"),
      goal,
      createdAt:now(),
      tasks,
      policy:{
        independentVerification:true,
        destructiveActionsRequireApproval:true,
        releaseRequiresApproval:request.release === true,
        maxParallel:Math.max(1,Number(request.maxParallel)||8)
      }
    };
  }

  async execute(plan, context={}) {
    if (!plan?.tasks?.length) throw new Error("Execution plan is empty");
    const pending = new Map(plan.tasks.map(task => [task.id, task]));
    const completed = new Map();
    const results = [];

    while (pending.size) {
      const ready = [...pending.values()].filter(task =>
        arr(task.dependsOn).every(dep => completed.has(dep))
      );
      if (!ready.length) throw new Error("Capability plan contains a dependency cycle");

      const batch = ready.slice(0, plan.policy?.maxParallel || 8);
      const outputs = await Promise.all(batch.map(async task => {
        if (!this.executor) return {task,result:{status:"planned",capability:task.capability}};
        return {task,result:await this.executor({
          task,
          inputs:arr(task.dependsOn).map(dep => completed.get(dep)),
          context
        })};
      }));

      for (const output of outputs) {
        completed.set(output.task.id, output.result);
        pending.delete(output.task.id);
        results.push(output);
      }
    }

    const verificationTask = plan.tasks.find(task => task.capability === "verification");
    let verification = null;
    if (verificationTask && this.verifier) {
      verification = await this.verifier({plan,results,context});
      if (!verification?.passed) {
        return {status:"blocked",plan,results,verification};
      }
    }

    return {
      status:"completed",
      plan,
      results,
      verification,
      completedAt:now()
    };
  }
}

export function createCapabilityKernel(options={}) {
  return new CapabilityKernel(options);
}
