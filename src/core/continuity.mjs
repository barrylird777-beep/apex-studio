export class ContinuityLedger {
  constructor() { this.records=[]; }
  record(item) {
    const entry={id:crypto.randomUUID(), ...item, createdAt:new Date().toISOString()};
    this.records.push(entry); return entry;
  }
  query(filter={}) {
    return this.records.filter(r => Object.entries(filter).every(([k,v]) => r[k]===v));
  }
  conflicts() {
    const byKey=new Map();
    for (const r of this.records) {
      if (!r.key) continue;
      if (!byKey.has(r.key)) byKey.set(r.key,[]);
      byKey.get(r.key).push(r);
    }
    return [...byKey.values()].filter(group => new Set(group.map(x=>JSON.stringify(x.value))).size>1);
  }
}
