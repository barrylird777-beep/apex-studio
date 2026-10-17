# Peer Trust Epoch Configuration

Peer protocol 1.2.0 binds the sender's trust epoch into each request digest. Production ingress requires an operator-provided trust map; an empty or missing map rejects peer requests.

## Configuration

- `APEX_PEER_TRUST_EPOCH` is this process's outbound epoch. It must match the epoch each remote peer expects for this peer ID.
- `APEX_PEER_TRUST_EPOCHS_JSON` is a JSON object keyed by the authenticated remote libp2p peer ID. Each value contains a nonnegative integer `epoch` and may set `revoked: true` (or `status: "revoked"`).
- The map is loaded at process start. Configuration changes require a process restart.

Example shape only; replace the placeholder key with a peer ID obtained from the authenticated operator inventory:

```json
{
  "peer-id-from-operator-inventory": {
    "epoch": 0,
    "revoked": false
  }
}
```

## Key/epoch rotation procedure

1. Record the peer identity and current epoch from operator-controlled evidence.
2. Choose a strictly greater epoch. Update the sender's `APEX_PEER_TRUST_EPOCH` and update every receiving peer's trust map to expect that epoch.
3. Restart affected peers, then verify authenticated traffic and rejection of a request carrying the previous epoch.
4. Preserve the change record and test receipts. Do not claim rotation verified from environment changes alone.

## Revocation procedure

1. Set the affected peer record to `revoked: true` in every receiving peer's trust map.
2. Restart those peers and verify the revoked peer is rejected.
3. Preserve previous configuration and evidence for recovery/audit.

## Limitations

This is static, operator-controlled configuration—not a dynamically replicated revocation service, threshold-governed trust registry, or consensus protocol. If peers are not updated consistently, valid traffic may fail closed. This control does not replace platform-specific attestation or independent failure-domain verification.