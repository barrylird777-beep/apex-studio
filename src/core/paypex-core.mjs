import { randomUUID } from "node:crypto";
import { channelIntelligence } from "./youtube-intelligence.mjs";

const num = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const text = v => String(v ?? "").trim();
const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, Number(v) || 0));

function economics(input = {}) {
  return {
    revenuePotential: clamp(num(input.revenuePotential, 0.5)),
    productionCost: clamp(num(input.productionCost, 0.5)),
    speedToMarket: clamp(num(input.speedToMarket, 0.5)),
    audienceFit: clamp(num(input.audienceFit, 0.5)),
    repeatability: clamp(num(input.repeatability, 0.5))
  };
}

export function scoreOpportunity(input = {}) {
  const e = economics(input);
  const evidence = clamp(num(input.evidence, 0.5));
  const demand = clamp(num(input.demand, 0.5));
  const novelty = clamp(num(input.novelty, 0.5));
  const risk = clamp(num(input.risk, 0.25));
  const score =
    0.22 * demand +
    0.20 * evidence +
    0.16 * e.audienceFit +
    0.14 * e.revenuePotential +
    0.10 * e.speedToMarket +
    0.08 * e.repeatability +
    0.06 * novelty -
    0.12 * risk -
    0.06 * e.productionCost;
  return {
    score: Math.round(clamp(score) * 1000) / 10,
    signals: { demand, evidence, audienceFit: e.audienceFit, revenuePotential: e.revenuePotential, speedToMarket: e.speedToMarket, repeatability: e.repeatability, novelty, risk, productionCost: e.productionCost }
  };
}

export async function getPaypexSnapshot() {
  const state = await channelIntelligence.load();
  const summary = channelIntelligence.summary();
  const opportunities = Array.isArray(summary.opportunities) ? summary.opportunities : [];
  const ranked = opportunities.map((item, index) => {
    const avgViews = num(item.avgViews);
    const retention = clamp(num(item.avgRetention) / 100);
    const ctr = clamp(num(item.avgCtr) / 10);
    const evidence = clamp(num(item.evidenceVideos) / 10);
    const demand = clamp(avgViews > 0 ? Math.log10(avgViews + 1) / 7 : 0);
    return {
      id: "paypex-opportunity-" + index,
      topic: text(item.topic) || "Unclassified",
      evidenceVideos: num(item.evidenceVideos),
      avgViews,
      avgRetention: num(item.avgRetention),
      avgCtr: num(item.avgCtr),
      ...scoreOpportunity({
        demand,
        evidence,
        audienceFit: retention,
        revenuePotential: demand,
        speedToMarket: 0.8,
        repeatability: clamp(evidence + 0.2),
        novelty: clamp(1 - ctr * 0.35),
        risk: 0.15,
        productionCost: 0.35
      })
    };
  }).sort((a, b) => b.score - a.score);

  return {
    engine: "PayPex",
    system: "apex-studio",
    role: "paypex_decision_engine",
    purpose: "money-making stock, market, business and monetization intelligence",
    state: state.channel ? "evidence-backed" : "awaiting-evidence",
    source: "Apex channel intelligence",
    lifetime: summary.lifetime || null,
    opportunities: ranked,
    actions: ranked.slice(0, 10).map(item => ({
      id: randomUUID(),
      opportunityId: item.id,
      action: "build-brief",
      handoff: "TeeVee",
      ownerSystem: "apex-studio",
      ownerApp: "PayPex",
      status: "proposed"
    })),
    separation: {
      PayPex: "Studio money-making stock, market, business and monetization intelligence",
      ApexStudio: "production, mastering, QC, delivery and infrastructure",
      TeeVee: "Studio production surface for original animated entertainment",
      GardenOfApex: "knowledge and research source where applicable",
      KORNKNOB: "AI, model, media and computational capability"
    },
    generatedAt: new Date().toISOString()
  };
}

export function buildPaypexBrief(input = {}) {
  const topic = text(input.topic);
  if (!topic) throw new TypeError("topic is required");
  return {
    id: randomUUID(),
    engine: "PayPex",
    system: "apex-studio",
    topic,
    objective: text(input.objective) || "Test the highest-value opportunity with the smallest credible production.",
    audience: text(input.audience) || "existing Apex audience",
    monetization: text(input.monetization) || "attention → audience growth → downstream revenue",
    evidenceRequired: true,
    handoff: text(input.handoff) || "TeeVee",
    createdAt: new Date().toISOString()
  };
}
