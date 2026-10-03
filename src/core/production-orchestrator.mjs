import crypto from "node:crypto";

const arr = value => Array.isArray(value) ? value : [];

export function createProductionJob(input = {}) {
  return {
    id: input.id ?? crypto.randomUUID(),
    type: input.type ?? "production",
    status: input.status ?? "queued",
    payload: input.payload ?? {},
    priority: Number(input.priority ?? 0),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function planProductionJobs(input = {}) {
  const jobs = arr(input.jobs).length ? input.jobs.map(createProductionJob) : [createProductionJob(input)];
  return { id: input.id ?? crypto.randomUUID(), jobs, status: "planned", createdAt: new Date().toISOString() };
}

export function runnableJobs(plan = {}, completedIds = []) {
  const completed = new Set(arr(completedIds));
  return arr(plan.jobs).filter(job => job.status === "queued" && !completed.has(job.id));
}

export function startJob(job = {}) {
  if (!job.id) throw new Error("Production job id is required");
  return { ...job, status: "running", startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function completeJob(job = {}, output = null, validation = null) {
  return { ...job, status: "completed", output, validation, completedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function failJob(job = {}, error = "Unknown error") {
  return { ...job, status: "failed", error: String(error), failedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

export function blockPlan(plan = {}, reason = "Blocked") {
  return { ...plan, status: "blocked", blocker: String(reason), updatedAt: new Date().toISOString() };
}

export function auditProductionPlan(plan = {}) {
  const jobs = arr(plan.jobs);
  const blockers = jobs.filter(job => job.status === "failed").map(job => job.id);
  return { ready: blockers.length === 0 && plan.status !== "blocked", blockers, jobCount: jobs.length };
}

export function orchestratorDecision(input = {}) {
  const plan = input.plan ?? {};
  return auditProductionPlan(plan).ready ? { action: "continue", reason: "plan-ready" } : { action: "hold", reason: "plan-blocked-or-failed" };
}
