/**
 * Deterministic, single-threaded fault-injection substrate.
 * This is a model/test harness, not a replacement for Node's live event loop.
 * Production adapters should connect explicit clock, transport, and store boundaries.
 */
function seedToUint32(seed) {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 0x6d2b79f5;
}

export class DeterministicSimulator {
  constructor({ seed = 1, startTime = 0 } = {}) {
    this.seed = String(seed);
    this._randomState = seedToUint32(seed);
    this.now = Number(startTime);
    if (!Number.isFinite(this.now)) throw new TypeError("startTime must be finite");
    this._nextId = 1;
    this._sequence = 0;
    this._events = [];
    this.trace = [];
  }

  random() {
    let x = this._randomState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this._randomState = x >>> 0;
    return this._randomState / 0x100000000;
  }

  randomInt(minInclusive, maxInclusive) {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxInclusive) || maxInclusive < minInclusive) {
      throw new RangeError("randomInt requires integer bounds with max >= min");
    }
    return minInclusive + Math.floor(this.random() * (maxInclusive - minInclusive + 1));
  }

  schedule(delayMs, callback, label = "event") {
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new RangeError("delayMs must be finite and >= 0");
    if (typeof callback !== "function") throw new TypeError("callback must be a function");
    const event = { id: this._nextId++, at: this.now + delayMs, sequence: this._sequence++, callback, label: String(label) };
    this._events.push(event);
    return event.id;
  }

  cancel(eventId) {
    const before = this._events.length;
    this._events = this._events.filter(event => event.id !== eventId);
    return this._events.length !== before;
  }

  setTimeout(callback, delayMs, label = "timer") {
    return this.schedule(delayMs, callback, label);
  }

  clearTimeout(eventId) {
    return this.cancel(eventId);
  }

  async run({ until = Infinity, maxEvents = 100000 } = {}) {
    if (!(until === Infinity || Number.isFinite(until))) throw new TypeError("until must be finite or Infinity");
    if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new RangeError("maxEvents must be a positive integer");
    let processed = 0;
    const sortEvents = () => this._events.sort((a, b) => a.at - b.at || a.sequence - b.sequence);
    sortEvents();
    while (this._events.length && this._events[0].at <= until) {
      if (processed >= maxEvents) {
        throw new Error("SIMULATOR_EVENT_LIMIT seed=" + this.seed + " processed=" + processed);
      }
      const event = this._events.shift();
      this.now = event.at;
      this.trace.push({ type: "event:start", at: this.now, id: event.id, label: event.label });
      await event.callback(this);
      this.trace.push({ type: "event:end", at: this.now, id: event.id, label: event.label });
      processed += 1;
      sortEvents();
    }
    if (Number.isFinite(until)) this.now = Math.max(this.now, until);
    return { processed, pending: this._events.length, now: this.now, seed: this.seed };
  }
}

function linkKey(a, b) {
  return [String(a), String(b)].sort().join("\u0000");
}

export class SimulatedNetwork {
  constructor(simulator, { latencyMs = 1, jitterMs = 0, dropRate = 0 } = {}) {
    if (!(simulator instanceof DeterministicSimulator)) throw new TypeError("simulator is required");
    this.simulator = simulator;
    this.latencyMs = latencyMs;
    this.jitterMs = jitterMs;
    this.dropRate = dropRate;
    this.partitions = new Set();
    this.receivers = new Map();
  }

  register(peerId, receive) {
    if (typeof receive !== "function") throw new TypeError("receiver must be a function");
    this.receivers.set(String(peerId), receive);
    return () => this.receivers.delete(String(peerId));
  }

  partition(a, b) {
    this.partitions.add(linkKey(a, b));
    this.simulator.trace.push({ type: "network:partition", at: this.simulator.now, a: String(a), b: String(b) });
  }

  heal(a, b) {
    const removed = this.partitions.delete(linkKey(a, b));
    this.simulator.trace.push({ type: "network:heal", at: this.simulator.now, a: String(a), b: String(b), removed });
    return removed;
  }

  send(from, to, payload, { dropRate = this.dropRate, latencyMs = this.latencyMs, label = "packet" } = {}) {
    const source = String(from), target = String(to);
    if (!Number.isFinite(dropRate) || dropRate < 0 || dropRate > 1) throw new RangeError("dropRate must be between 0 and 1");
    if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new RangeError("latencyMs must be >= 0");
    if (this.partitions.has(linkKey(source, target))) {
      this.simulator.trace.push({ type: "network:drop", reason: "partition", at: this.simulator.now, from: source, to: target, label });
      return { accepted: false, reason: "partition" };
    }
    if (this.simulator.random() < dropRate) {
      this.simulator.trace.push({ type: "network:drop", reason: "packet-loss", at: this.simulator.now, from: source, to: target, label });
      return { accepted: false, reason: "packet-loss" };
    }
    const jitter = this.jitterMs > 0 ? this.simulator.randomInt(0, this.jitterMs) : 0;
    const delay = latencyMs + jitter;
    const body = structuredClone(payload);
    this.simulator.schedule(delay, async () => {
      const receiver = this.receivers.get(target);
      if (!receiver) {
        this.simulator.trace.push({ type: "network:drop", reason: "no-receiver", at: this.simulator.now, from: source, to: target, label });
        return;
      }
      this.simulator.trace.push({ type: "network:deliver", at: this.simulator.now, from: source, to: target, label, payload: body });
      await receiver(structuredClone(body), { from: source, to: target, at: this.simulator.now });
    }, "network:" + label + ":" + source + "->" + target);
    this.simulator.trace.push({ type: "network:send", at: this.simulator.now, from: source, to: target, delay, label });
    return { accepted: true, delay };
  }
}

export class SimulatedDisk {
  constructor({ capacityBytes = Infinity } = {}) {
    if (!(capacityBytes === Infinity || (Number.isSafeInteger(capacityBytes) && capacityBytes >= 0))) {
      throw new RangeError("capacityBytes must be a non-negative safe integer or Infinity");
    }
    this.capacityBytes = capacityBytes;
    this.entries = new Map();
    this.usedBytes = 0;
  }

  write(key, value) {
    const id = String(key);
    const encoded = JSON.stringify(value);
    const bytes = Buffer.byteLength(encoded, "utf8");
    const previous = this.entries.get(id);
    const nextUsed = this.usedBytes - (previous?.bytes || 0) + bytes;
    if (nextUsed > this.capacityBytes) {
      throw Object.assign(new Error("ENOSPC: simulated disk capacity exceeded for " + id), {
        code: "ENOSPC", key: id, capacityBytes: this.capacityBytes, usedBytes: this.usedBytes, attemptedBytes: bytes
      });
    }
    this.entries.set(id, { value: structuredClone(value), bytes });
    this.usedBytes = nextUsed;
    return { key: id, bytes, usedBytes: this.usedBytes };
  }

  read(key) {
    const entry = this.entries.get(String(key));
    return entry ? structuredClone(entry.value) : undefined;
  }

  delete(key) {
    const id = String(key), previous = this.entries.get(id);
    if (!previous) return false;
    this.entries.delete(id);
    this.usedBytes -= previous.bytes;
    return true;
  }

  snapshot() {
    return { capacityBytes: this.capacityBytes, usedBytes: this.usedBytes, entries: this.entries.size };
  }
}
