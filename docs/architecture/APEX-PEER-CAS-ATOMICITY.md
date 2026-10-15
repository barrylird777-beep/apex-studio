# APEX Peer CAS Atomicity Contract

Status: implementation gate; this document does not claim the distributed protocol is implemented.

## Safety invariant

For a reference key in one app namespace, a successful mutation must have one linearizable outcome: exactly one expected prior CID is replaced by the proposed CID. A replica-local CAS is not a globally atomic CAS.

## Current implementation hazard

`PeerContentAddressedStore.writeRef` sends `ref.cas` to peers sequentially and counts successful receipts. If some peers accept and others reject or time out, the method can throw after the reference has changed on a subset of peers. A retry or a later read can then observe divergent heads. Receipt counting does not resolve that ambiguity.

## Required protocol before enabling writes

1. Define a per-reference consensus authority/protocol and a stable membership/epoch. Do not infer authority from peer iteration order.
2. Bind every proposal to namespace, key, expected prior CID, proposed CID, membership epoch, and unique operation ID.
3. Require a quorum decision under a documented crash/partition model. Byzantine tolerance requires a protocol and quorum assumptions designed for Byzantine faults; a majority of ordinary CAS replies is not enough.
4. Separate decision from replication. Replicas must be able to recover a committed decision after coordinator loss; an uncommitted proposal must never become visible as the head.
5. Make retries idempotent by operation ID. Return explicit states: committed, rejected-conflict, or outcome-unknown. Never report an outcome-unknown operation as a definite failure if it may have committed.
6. Keep immutable object writes safe to retry. A reference may point only to a verified immutable object.
7. If quorum is unavailable, fail closed and preserve the prior committed head. Do not fall back to local persistence or silently choose one divergent replica.
8. Define read semantics: only expose heads supported by the protocol's committed decision; divergent replicas trigger recovery, not last-writer-wins selection.

## Acceptance tests

- Two concurrent proposals using the same expected prior CID: at most one commits.
- A stale expected CID is rejected without changing the committed head.
- Drop replies after a replica applies a proposal; retry with the same operation ID returns the original outcome.
- Kill the coordinator after decision but before replication; a new coordinator recovers the same decision.
- Partition replicas below quorum; no new head is committed.
- Corrupt an object or receipt; it is rejected before it can become a visible head.
- Cross-namespace proposal is denied.
- Restart with empty RAM; committed heads and referenced objects are recovered from peers.
- Inject Byzantine/conflicting replies; the protocol does not select a head outside its documented fault assumptions.

## Implementation rule

Do not retrofit a pretend two-phase commit or a sequential write loop and call it consensus. Choose and implement a reviewed consensus design with explicit assumptions, then prove the adapter against these tests. Until then, the multi-peer `writeRef` API must not be represented as globally atomic.
