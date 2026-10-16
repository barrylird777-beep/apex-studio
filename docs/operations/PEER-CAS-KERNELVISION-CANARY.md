# KernelVision peer-storage canary and independent-host proof

This is an opt-in validation path, not a production storage migration. Do not disable, delete, or redirect legacy storage while collecting evidence.

## Preconditions

1. Provision at least two peer processes on **independently operated physical machines** with persistent, peer-owned storage backends. Each backend must implement `putBytes`, `getBytes`, atomic `readRef`/`writeRef`, `health`, and `verifyDurabilityReceipt`, and expose `capacityRoot` (or `storageRoot`) that exactly matches `APEX_PEER_OWNED_STORAGE_ROOT`. The advertised filesystem capacity is rejected if it cannot be bound to that backend root. The health receipt must prove the actual backend survived a process restart and its references are atomic.
2. Give every peer a stable libp2p identity and explicit TCP multiaddress. Add each peer ID to the authenticated peer allowlist and namespace ACL. Do not share private keys or tokens in issue comments or chat.
3. On each storage peer configure:
   - `APEX_PEER_STORAGE_ENABLED=true`
   - `APEX_PEER_STORAGE_BACKEND_MODULE` pointing at the operator-supplied backend adapter
   - `APEX_PEER_CAS_NAMESPACE=KernelVision`
   - `APEX_PEER_OWNED_STORAGE_ROOT` pointing at the actual volume reserved for peer data
   - `APEX_PEER_FAILURE_DOMAIN` set to a truthful host/rack/site domain
   - `APEX_PEER_NAMESPACE_ACL` allowing the authenticated writer peer ID
4. On the writer/daemon configure:
   - `APEX_PEER_CAS_ENABLED=true`
   - `APEX_PEER_CAS_NAMESPACE=KernelVision`
   - `APEX_PEER_CAS_PEERS=peer-id=/ip4/REAL_IP/tcp/PORT/p2p/peer-id;peer-id-2=/ip4/REAL_IP/tcp/PORT/p2p/peer-id-2`
   - `APEX_PEER_TRUSTED_FAILURE_DOMAINS=peer-id=host-a;peer-id-2=host-b`
   - `APEX_PEER_CAS_REPLICAS=2` and `APEX_PEER_CAS_FAILURE_DOMAINS=2`
   - a fresh 32-byte `APEX_PEER_CAS_ENCRYPTION_KEY_BASE64`, strong `APEX_PEER_CAS_TOKEN`, and `APEX_PEER_CAS_ALLOWED_MODELS` entries required by the current bridge
   - `APEX_KERNELVISION_PEER_CANARY_ENABLED=true`
5. Configure `APEX_CONTROL_TOKEN` or `APEX_SHORTCUT_TOKEN` for the app API. Keep it separate from the Peer-CAS bridge token. Restart only the canary/peer services, not legacy storage.

Never copy the example values literally. Do not post tokens, private keys, or full environment dumps.

## Canary smoke test

With a valid control-plane token, write a non-sensitive, disposable metadata record:

```sh
curl --fail-with-body -sS -X PUT \
  -H "Authorization: Bearer $APEX_CONTROL_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"value":{"marker":"kernelvision-peer-canary","purpose":"durability-check"}}' \
  "$APEX_BASE_URL/api/kernelvision/peer-canary/durability-check"
```

The response must include a content hash, at least two replica peer IDs, and their durability receipts. Save the response as evidence, with secrets removed. Read it back:

```sh
curl --fail-with-body -sS \
  -H "Authorization: Bearer $APEX_CONTROL_TOKEN" \
  "$APEX_BASE_URL/api/kernelvision/peer-canary/durability-check"
```

Confirm the returned value and hash match the write result.

## Independent-host restart/recovery proof

1. Record the physical host/rack identity for each returned replica, peer IDs, write hash, receipt IDs, and UTC time. Do not count two processes on one machine as independent hosts.
2. Stop one replica peer completely. Do not delete its volume.
3. Read the canary through the writer and confirm the surviving peer can serve the same value/hash.
4. Restart the stopped peer against the same persistent volume and same peer identity.
5. Read again and confirm hash and atomic reference are unchanged; collect fresh backend-signed restart/recovery evidence.
6. Verify the required replica count and distinct trusted failure domains again. A successful HTTP read alone does not prove both replicas are healthy or that the stopped peer recovered.
7. Repeat with each replica as the stopped peer, then inspect logs and receipts from the backend/host operators.

If any step fails, keep the canary isolated and leave existing production storage unchanged. Capacity reports are measurements, not proof of durable storage; only backend-verified receipts plus this independent-host recovery exercise can close that gap.

## API and isolation

- `GET /api/kernelvision/peer-canary/:key`
- `PUT /api/kernelvision/peer-canary/:key` with JSON body `{"value": ...}`
- The API requires the existing control-plane auth and an explicitly enabled canary.
- The private Unix-socket bridge requires `APEX_PEER_CAS_TOKEN`, and serves this route only when its live Peer-CAS namespace is `KernelVision`.
- Writes are limited to the `canary-v1:` reference prefix and do not migrate existing app records.
