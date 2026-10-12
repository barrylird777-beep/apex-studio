import { FrictionlessResearchEngine } from '../src/core/research/frictionless-research-engine.mjs';

const query = process.argv.slice(2).join(' ').trim();
if (!query) {
  console.error('Usage: node scripts/research-ingest.mjs "<paper title | DOI | identifier>"');
  process.exit(2);
}

const engine = new FrictionlessResearchEngine();
const work = await engine.resolveWork(query);
const evidence = await engine.expandEvidence(work, { maxReferences: Number(process.env.APEX_RESEARCH_MAX_REFERENCES || 20) });
const graph = engine.buildEvidenceGraph(work, evidence);
const reconstruction = await engine.reconstruct(work, evidence);

console.log(JSON.stringify({
  work,
  evidence,
  graph,
  reconstruction
}, null, 2));
