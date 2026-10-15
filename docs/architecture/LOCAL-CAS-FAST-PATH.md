# Local CAS fast path

`LocalCasFastPath` is a bounded, volatile acceleration layer. It is not durable storage, does not survive process restart, and must never be used to acknowledge a peer write as durable.

## Contract

- Immutable bytes are copied into owned memory and addressed by SHA-256 CID.
- A repeated CID must match the existing bytes; otherwise the operation fails closed as a CID collision.
- Cache capacity is bounded by payload bytes, object count, pointer count, and a 30-second sliding idle TTL. LRU eviction removes the oldest eligible entries.
- Mutable local heads use a synchronous compare-and-swap pointer swap. Concurrent writers with the same expected CID cannot both succeed in one process.
- Public reads return defensive byte copies. JavaScript `Buffer` objects are mutable, so the API does not expose zero-copy views that could let a caller mutate cached bytes.
- The peer-backed `PeerContentAddressedStore` uses this layer only as a verified RAM cache. Peer reads/writes, quorum policy, receipts, and remote CAS checks remain mandatory.

## Reproduce

```sh
npm test
npm run bench:local-cas
```

The benchmark prints p50/p95/p99 for immutable put/hash/copy, local pointer CAS, and RAM-hit copy. It is explicitly labeled **synthetic in-process RAM only**. It is not a network, independent-peer, hardware-attestation, restart-recovery, or Byzantine-consensus measurement. Benchmark output is console-only; no report or media artifact is persisted.

## Not yet proven

This fast path does not provide atomic CAS across independent peers. The reviewed distributed CAS protocol, peer-owned atomic capacity reservations, peer-loss recovery, and multi-process adversarial tests remain launch blockers.
