export class LockFreeQueue {
  constructor(capacity = 65536) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.head = 0;
    this.tail = 0;
  }
  get size() { return this.tail - this.head; }
  tryPush(value) {
    if (this.size >= this.capacity) return false;
    this.buffer[this.tail % this.capacity] = value;
    this.tail++;
    return true;
  }
  tryPop() {
    if (this.head >= this.tail) return undefined;
    const i = this.head++ % this.capacity;
    const value = this.buffer[i];
    this.buffer[i] = undefined;
    return value;
  }
}
export class CompletionRing extends LockFreeQueue {}
