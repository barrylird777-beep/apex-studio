export const DurabilityState = Object.freeze({
  RECEIVED: 'RECEIVED',
  MEMORY_VISIBLE: 'MEMORY_VISIBLE',
  LOGGED: 'LOGGED',
  DURABLE: 'DURABLE',
  COMMITTED: 'COMMITTED'
});

export class SovereignRdmaTransport {
  constructor({ backend = null } = {}) {
    this.backend = backend;
  }

  capabilities() {
    return this.backend?.capabilities?.() || { rdma: false, zeroCopy: false, native: false };
  }

  async transfer(buffer, metadata = {}) {
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) throw new TypeError('buffer must be bytes');
    if (!this.backend) throw new Error('RDMA backend unavailable; no fake transport is provided');
    let state = DurabilityState.RECEIVED;
    state = DurabilityState.MEMORY_VISIBLE;
    await this.backend.write(buffer, metadata);
    state = DurabilityState.LOGGED;
    await this.backend.flush?.();
    state = DurabilityState.DURABLE;
    return { state, metadata };
  }

  async commit(receipt) {
    if (!receipt || receipt.state !== DurabilityState.DURABLE) throw new Error('only durable RDMA receipts can commit');
    return { ...receipt, state: DurabilityState.COMMITTED };
  }
}

export async function loadRdmaBackend(spec = process.env.APEX_RDMA_BACKEND_MODULE) {
  if (!spec) return null;
  const mod = await import(spec);
  const Backend = mod.default || mod.RdmaBackend || mod;
  return new Backend();
}
