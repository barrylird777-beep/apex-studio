import { createHash, sign } from 'node:crypto';

export class SovereignComputeMarket {
  constructor({ identity, maxPrice = 0 } = {}) {
    this.identity = identity;
    this.maxPrice = Number(maxPrice);
    this.offers = new Map();
    this.ledger = [];
  }
  offer(nodeId, resources, price, expiresAt) {
    const offer = { nodeId, resources, price: Number(price), expiresAt, id: createHash('sha256').update(JSON.stringify({ nodeId, resources, price, expiresAt })).digest('hex') };
    this.offers.set(offer.id, offer);
    return offer;
  }
  select(requirements) {
    return [...this.offers.values()]
      .filter(o => o.expiresAt > Date.now() && o.price <= this.maxPrice)
      .filter(o => Object.entries(requirements).every(([k,v]) => Number(o.resources[k] || 0) >= Number(v)))
      .sort((a,b) => a.price - b.price)[0] || null;
  }
  async authorizePayment(offer, amount) {
    if (!this.identity) throw new Error('payment identity unavailable');
    const payload = JSON.stringify({ offerId: offer.id, amount: Number(amount), issuedAt: Date.now() });
    return { payload, signature: sign(null, Buffer.from(payload), this.identity) };
  }
  recordSettlement(settlement) {
    this.ledger.push(Object.freeze({ ...settlement, recordedAt: Date.now() }));
  }
}
