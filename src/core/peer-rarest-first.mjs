/** Deterministic rarest-first ordering for authenticated peer chunk advertisements. */
export function orderChunksRarestFirst(requiredCids, advertisements) {
  if (!Array.isArray(requiredCids) || !Array.isArray(advertisements)) {
    throw new TypeError('required CIDs and peer advertisements must be arrays');
  }
  const counts = new Map();
  for (const cid of requiredCids) {
    if (typeof cid !== 'string' || !/^[a-f0-9]{64}$/.test(cid)) throw new TypeError('invalid required chunk CID');
    counts.set(cid, 0);
  }
  for (const ad of advertisements) {
    if (!ad || ad.authenticated !== true || !Array.isArray(ad.cids)) continue;
    for (const cid of new Set(ad.cids)) if (counts.has(cid)) counts.set(cid, counts.get(cid) + 1);
  }
  return [...counts].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([cid, sourceCount]) => Object.freeze({ cid, sourceCount }));
}
