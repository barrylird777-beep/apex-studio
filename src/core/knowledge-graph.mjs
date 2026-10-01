import { entity, relation } from "./schema.mjs";

export class KnowledgeGraph {
  constructor(seed={entities:[],relations:[]}) {
    this.entities = new Map(seed.entities.map(e => [e.id, e]));
    this.relations = new Map(seed.relations.map(r => [r.id, r]));
  }
  addEntity(input) { const e = entity(input); this.entities.set(e.id,e); return e; }
  addRelation(input) { const r = relation(input); if (!this.entities.has(r.from) || !this.entities.has(r.to)) throw new Error("Relation endpoints must exist"); this.relations.set(r.id,r); return r; }
  getEntity(id) { return this.entities.get(id) ?? null; }
  neighbors(id, type=null) { return [...this.relations.values()].filter(r => (r.from===id || r.to===id) && (!type || r.type===type)); }
  search(query) {
    const q=String(query).toLowerCase().trim();
    return [...this.entities.values()].filter(e => [e.name,...e.aliases,e.tags].join(" ").toLowerCase().includes(q));
  }
  snapshot() { return {entities:[...this.entities.values()],relations:[...this.relations.values()]}; }
}
