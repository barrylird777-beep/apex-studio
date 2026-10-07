export class VectorAccelerator {
  capabilities() { return { name: 'abstract', hardware: false, dimensions: [], batch: false }; }
  async loadIndex() { throw new Error('VectorAccelerator.loadIndex not implemented'); }
  async insert() { throw new Error('VectorAccelerator.insert not implemented'); }
  async batchInsert(items) { for (const item of items) await this.insert(item); }
  async search() { throw new Error('VectorAccelerator.search not implemented'); }
  async batchSearch(queries) { return Promise.all(queries.map(q => this.search(q))); }
  async close() {}
}

export class CpuHnswAccelerator extends VectorAccelerator {
  constructor(index) { super(); this.index = index; }
  capabilities() { return { name: 'cpu-hnsw', hardware: false, dimensions: 'any', batch: true }; }
  async loadIndex() { await this.index.load(); return this; }
  async insert({ id, vector, metadata }) { return this.index.add(id, vector, metadata); }
  async search({ vector, k = 10 }) { return this.index.search(vector, k); }
}
