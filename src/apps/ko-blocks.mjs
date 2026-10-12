import crypto from "node:crypto";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("ko-blocks");
const clone = value => structuredClone(value);
const text = (value, fallback = "") => String(value ?? fallback).trim().slice(0, 4000);
const idOf = value => {
  const id = String(value ?? "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(id)) throw new TypeError("KoBlocks id is invalid");
  return id;
};

export function defineKoBlock(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("KoBlocks input must be an object");
  const id = idOf(input.id || crypto.randomUUID());
  return {
    id,
    name: String(input.name || id),
    version: String(input.version || "1.0.0"),
    kind: String(input.kind || "component"),
    inputs: Array.isArray(input.inputs) ? [...new Set(input.inputs.map(text).filter(Boolean))] : [],
    outputs: Array.isArray(input.outputs) ? [...new Set(input.outputs.map(text).filter(Boolean))] : [],
    config: input.config && typeof input.config === "object" && !Array.isArray(input.config) ? clone(input.config) : {},
    provenance: input.provenance && typeof input.provenance === "object" && !Array.isArray(input.provenance) ? clone(input.provenance) : null
  };
}

export function composeKoBlocks(blocks = [], edges = []) {
  const list = (Array.isArray(blocks) ? blocks : []).map(defineKoBlock);
  const ids = new Set();
  for (const block of list) {
    if (ids.has(block.id)) throw new Error("KoBlocks duplicate block id: " + block.id);
    ids.add(block.id);
  }
  const links = (Array.isArray(edges) ? edges : []).map(edge => {
    if (!edge || typeof edge !== "object" || Array.isArray(edge)) throw new TypeError("KoBlocks edge must be an object");
    const from = idOf(edge.from);
    const to = idOf(edge.to);
    if (!ids.has(from) || !ids.has(to)) throw new Error("KoBlocks edge references an unknown block");
    const port = edge.port == null ? null : text(edge.port);
    if (edge.port != null && !port) throw new Error("KoBlocks edge port cannot be empty");
    return { from, to, port };
  });
  return { version: "koblx.v1", blocks: list, edges: links };
}

export function validateKoBlockGraph(graph) {
  if (!graph || !Array.isArray(graph.blocks) || !Array.isArray(graph.edges)) throw new TypeError("KoBlocks graph is invalid");
  const ids = new Set();
  for (const block of graph.blocks) {
    if (!block || !block.id || ids.has(block.id)) return { valid: false, reason: "duplicate-or-invalid-block" };
    ids.add(block.id);
  }
  const adjacency = new Map([...ids].map(id => [id, []]));
  const blocks = new Map(graph.blocks.map(block => [block.id, block]));
  const edgeKeys = new Set();
  for (const edge of graph.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) return { valid: false, reason: "unknown-block" };
    if (edge.from === edge.to) return { valid: false, reason: "self-loop" };
    const key = edge.from + "->" + edge.to + ":" + String(edge.port ?? "");
    if (edgeKeys.has(key)) return { valid: false, reason: "duplicate-edge" };
    edgeKeys.add(key);
    if (edge.port != null && Array.isArray(blocks.get(edge.from).outputs) && blocks.get(edge.from).outputs.length && !blocks.get(edge.from).outputs.includes(edge.port)) return { valid: false, reason: "unknown-output-port" };
    adjacency.get(edge.from).push(edge.to);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    visiting.add(id);
    for (const next of adjacency.get(id)) if (!visit(next)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  for (const id of ids) if (!visit(id)) return { valid: false, reason: "cycle" };
  return { valid: true, blockCount: graph.blocks.length, edgeCount: graph.edges.length };
}

export function koBlocksStatus() {
  return {
    app: { ...APP },
    role: APP.role,
    capabilities: ["block registry", "composition", "graph validation", "reusable components", "acyclic execution graphs"],
    canonical: true,
    checkedAt: new Date().toISOString()
  };
}
