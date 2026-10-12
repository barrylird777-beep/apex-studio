import { uid, now } from "./id.mjs";

export const GROWTH_SIGNALS=Object.freeze([
  "impressions","clicks","views","watchTime","retention","likes","comments","shares",
  "subscribersGained","returningViewers","endScreenClicks","revenue"
]);

export function createPackagingVariant(input={}) {
  return {
    id:input.id??uid("package"),
    episodeId:input.episodeId??null,
    title:input.title??"",
    thumbnailConcept:input.thumbnailConcept??"",
    promise:input.promise??"",
    hookAngle:input.hookAngle??"",
    status:"candidate",
    sourceRefs:Array.isArray(input.sourceRefs)?input.sourceRefs:[],
    createdAt:now()
  };
}

export function createGrowthExperiment(input={}) {
  return {
    id:input.id??uid("growth"),
    episodeId:input.episodeId??null,
    objective:input.objective??"learn which packaging/story signal improves viewer response",
    variants:Array.isArray(input.variants)?input.variants:[],
    metrics:input.metrics??{},
    observations:Array.isArray(input.observations)?input.observations:[],
    decision:null,
    createdAt:now(),
    updatedAt:now()
  };
}

export function recordGrowthMetrics(experiment={}, metrics={}) {
  const normalized={};
  for(const key of GROWTH_SIGNALS) if(Number.isFinite(metrics[key])) normalized[key]=metrics[key];
  return {...experiment,metrics:{...experiment.metrics,...normalized},updatedAt:now()};
}

export function recordGrowthObservation(experiment={}, observation={}) {
  return {...experiment,observations:[...(experiment.observations??[]),{
    id:uid("obs"),text:observation.text??"",source:observation.source??"observed-metric",
    metricKeys:Array.isArray(observation.metricKeys)?observation.metricKeys:[],createdAt:now()
  }],updatedAt:now()};
}

export function growthLearningReport(experiment={}) {
  const m=experiment.metrics??{};
  const observations=experiment.observations??[];
  return {
    experimentId:experiment.id??null,
    observedSignals:Object.keys(m),
    metrics:m,
    observations,
    nextTests:[
      "Change one major packaging variable at a time.",
      "Compare results over a meaningful sample instead of a single early datapoint.",
      "Preserve successful story patterns while continuing to test new concepts.",
      "Never treat an observed correlation as proof of causation."
    ],
    grounded:true
  };
}

export function buildGrowthPrompt(input={}) {
  return [
    "APEX GROWTH ANALYST",
    "Use only supplied episode artifacts and observed analytics.",
    "Generate hypotheses, not guarantees.",
    "Do not fabricate audience behavior, revenue, retention, or performance.",
    "Keep Scripture provenance and the episode's source boundaries intact.",
    "Return packaging hypotheses, retention hypotheses, experiment variables, metrics to watch, and follow-up tests.",
    input.context??""
  ].join("\n");
}
