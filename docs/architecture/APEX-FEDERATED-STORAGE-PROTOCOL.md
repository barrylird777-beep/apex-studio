# Federated Apex Storage Protocol

## Purpose
Restore the six-app Apex network as a federation of independently operated peers, not a single hosted storage service. Each peer owns its capacity and identity; the federation coordinates encrypted immutable objects and durability receipts.

## Topology
- Each participating device or host runs a peer node with a stable cryptographic identity and an explicitly advertised reachable libp2p address.
- Peers exchange signed capability advertisements: peer identity, supported protocol version, available capacity class, app namespaces authorized, and current reachability. Advertisements contain no private object contents or encryption keys.
- Each app has its own namespace and key domain. The six canonical app namespaces never share authorization implicitly.
- A placement policy selects eligible peers by app ACL, reachability, capacity, and failure domain. The writer sends encrypted binary blocks to peers directly.
- A write is durable only after independently authenticated receipts satisfy the configured replica and failure-domain quorum. Otherwise the write fails visibly and is not represented as saved.
- Reads query known replicas, validate content hashes and authenticated receipts, then decrypt only on an authorized client.
- Repair copies a verified object from a healthy replica to an eligible peer and verifies the new receipt before retiring a stale replica.

## Persistence and sovereignty constraints
- Durable payloads and manifests use canonical binary CBOR or another versioned binary format, not JSON.
- PostgreSQL and WAL are not part of the storage protocol.
- No node may silently substitute local disk or a vendor bucket when federation is unavailable.
- Peer-owned disks may hold durable replicas because those are the participating peers' storage capacity; the user's phone/browser storage is only a cache unless explicitly provisioned as a peer and kept online.
- Transport can use transient protocol envelopes, but those envelopes are not the durable source of truth.
- All replication, retrieval, deletion, key rotation, and repair operations are scoped to an app namespace and authenticated peer identity.

## Minimum viable federation
1. Two independently reachable peer nodes for a development round-trip; three peers across independent failure domains for stronger fault tolerance.
2. Explicit peer identities and allowlisted multiaddresses; no assumption that a peer is reachable merely because it exists in configuration.
3. Binary backend injected into each peer runtime; no default local filesystem fallback in the application data path.
4. Encrypted write, authenticated receipt, independent readback, digest verification, peer restart test, and replica-loss test.
5. A status surface that reports actual eligible peers, confirmed replicas, and quorum health. It must never report durable/ready based on process liveness alone.

## Recovery order
1. Preserve and inventory any surviving object stores and peer identities before changing them.
2. Recover existing source and metadata from the repository and any accessible exports; do not claim deleted volumes are recoverable.
3. Remove PostgreSQL and WAL from the active runtime, not merely from documentation.
4. Route app persistence through the federated peer adapter and eliminate JSON/local persistence fallbacks.
5. Run automated protocol tests, then a live multi-peer round-trip and restart/recovery test.
6. Cut over app-by-app only after readback and quorum evidence; retain rollback-safe exports until each cutover is verified.

## Current truth
The repository has a libp2p transport and encrypted content-addressed storage primitive. This protocol defines the intended federation; it is not evidence that peers are presently running or that historical data has been recovered. Federated storage still requires actual peer devices/hosts with reachable network paths and capacity. It cannot provide durable storage from zero participating peers.
