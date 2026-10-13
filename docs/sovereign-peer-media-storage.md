# Sovereign peer media storage wiring

This path is intentionally fail-closed. The HTTP API process sends binary canonical-CBOR requests to the local sovereign daemon over loopback. The daemon owns the authenticated libp2p node and assembles the six app-specific encrypted content-addressed clients.

## Required deployment configuration

Set these only on a deployment that is meant to host a storage peer:

- `APEX_STORAGE_MODE=peer` (or `APEX_PEER_STORAGE_ENABLED=true`)
- `APEX_APP_ID` to exactly one of `KernelVision`, `XShield`, `Kernelodies`, `PlanetApeX`, `KashKorner`, `KoinKob`
- `APEX_PEER_STORAGE_BACKEND_MODULE` to an absolute path or file URL for a trusted module exporting `createPeerStorageBackend({ peerId, env })`
- `APEX_PEER_NAMESPACE_ACL` with explicit canonical app namespaces and authorized writer peer IDs, for example `KernelVision=peer-id-a,peer-id-b;PlanetApeX=peer-id-c`
- For each app, `APEX_PEER_STORAGE_PEERS_<APP_SUFFIX>` as semicolon-separated `peerId@multiaddr` entries. Suffixes are uppercase with camel-case boundaries converted to underscores, e.g. `KERNEL_VISION` and `PLANET_APE_X`.
- For each app, `APEX_PEER_STORAGE_KEY_<APP_SUFFIX>` as canonical base64 for a 32-byte AES-256 key. Do not reuse keys across app namespaces.
- `APEX_PEER_STORAGE_REPLICA_COUNT` (defaults to 2), `APEX_PEER_STORAGE_MIN_FAILURE_DOMAINS` (defaults to 1), and `APEX_PEER_STORAGE_FAILURE_DOMAINS` as semicolon-separated `peerId=domain` entries. When more than one replica is required, each target peer must have an explicit failure domain.
- `APEX_PEER_PRIVATE_KEY_BASE64` or the existing peer identity provisioning required by the libp2p runtime.

The stack supervisor generates a fresh 256-bit bridge token and shares it only with its API and daemon child processes. The IPC listener binds to loopback and accepts only authenticated binary-CBOR requests. It does not expose the bridge on the public interface.

## Durable backend contract

The backend module must return an object implementing:

- `putBytes(hash, bytes)`
- `getBytes(hash)`
- `readRef(namespace, key)`
- `writeRef(namespace, key, expectedHash, hash, bytes)`

It must also explicitly declare `durable: true` and `ownership: 'peer-owned'`. Object writes must verify SHA-256; reference writes must provide atomic compare-and-swap semantics; data must remain recoverable after a process restart; and app namespaces must remain isolated. A RAM map, local filesystem fallback, or third-party hosted object bucket does not meet this contract.

**Important:** this repository wires the bridge and client assembly, but it does not ship a concrete durable backend module. Until a genuinely peer-owned durable backend is provisioned and its restart/recovery behavior is verified, enabling peer mode intentionally fails closed. Do not switch production storage mode or claim migration complete before that proof.
