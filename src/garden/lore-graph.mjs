import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GRAPH_FILE = path.join(ROOT, "lore-graph.jsonld");
const RULES_FILE = path.join(ROOT, "environmental-mechanics.json");

let graphPromise;
let rulesPromise;

async function loadGraph() {
  if (!graphPromise) graphPromise = readFile(GRAPH_FILE, "utf8").then(JSON.parse);
  return graphPromise;
}

async function loadRules() {
  if (!rulesPromise) rulesPromise = readFile(RULES_FILE, "utf8").then(JSON.parse);
  return rulesPromise;
}

export async function gardenSnapshot() {
  const [graph, rules] = await Promise.all([loadGraph(), loadRules()]);
  return { graph, rules };
}

export async function getGardenNode(id) {
  const { graph } = await gardenSnapshot();
  return graph["@graph"].find(node => node.id === id) || null;
}

export async function verifyGardenRelation(subjectId, relation, objectId) {
  const node = await getGardenNode(subjectId);
  if (!node) return false;
  const value = node[relation];
  return Array.isArray(value) ? value.includes(objectId) : value === objectId;
}

export async function requireGardenRelation(subjectId, relation, objectId) {
  if (!(await verifyGardenRelation(subjectId, relation, objectId))) {
    throw new Error(`Unverified Garden relation rejected: ${subjectId} -[${relation}]-> ${objectId}`);
  }
  return true;
}

export async function verifiedGardenIds() {
  const { graph } = await gardenSnapshot();
  return new Set(graph["@graph"].map(node => String(node.id)));
}
